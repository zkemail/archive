terraform {
  required_version = ">= 1.0"

  # Add remote state backend with workspace support
  backend "gcs" {
    bucket = "terraform-state-archive"
    prefix = "terraform/state"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

# Local values for workspace-specific configurations
locals {
  # Map workspace names to environment configurations
  workspace_config = {
    "pr-validation" = {
      environment = "staging"
      suffix      = "pr"
    }
    "main" = {
      environment = "prod"
      suffix      = "prod"
    }
  }

  # Get current workspace config
  current_config = local.workspace_config[terraform.workspace]

  # Use workspace-specific environment or fall back to var.environment
  environment = local.current_config != null ? local.current_config.environment : var.environment
  suffix      = local.current_config != null ? local.current_config.suffix : "dev"

  # Workspace-specific resource naming
  resource_suffix = "${local.environment}-${local.suffix}"
}

# Provider configuration
provider "google" {
  project = var.project_id
  region  = var.region
}

# Enable required APIs
resource "google_project_service" "required_apis" {
  for_each = toset([
    "cloudfunctions.googleapis.com",
    "cloudtasks.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "run.googleapis.com",
    "eventarc.googleapis.com",
    "pubsub.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudscheduler.googleapis.com",
    "sqladmin.googleapis.com",
  ])

  service                    = each.value
  disable_dependent_services = false
  disable_on_destroy         = false
}

# Create service account for Cloud Function
resource "google_service_account" "function_sa" {
  account_id   = "fn-${local.resource_suffix}"
  display_name = "gcd Calculator Cloud Function Service Account (${terraform.workspace})"
  description  = "Service account for gcd calculator cloud function in ${terraform.workspace} workspace"
}

# Create service account for Cloud Tasks
resource "google_service_account" "tasks_sa" {
  account_id   = "tasks-${local.resource_suffix}"
  display_name = "gcd Calculator Cloud Tasks Service Account (${terraform.workspace})"
  description  = "Service account for Cloud Tasks to invoke cloud function in ${terraform.workspace} workspace"
}

# IAM bindings for function service account
resource "google_project_iam_member" "function_sa_roles" {
  for_each = toset([
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/cloudtrace.agent"
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.function_sa.email}"
}

# IAM binding for tasks service account to invoke functions
resource "google_project_iam_member" "tasks_function_invoker" {
  project = var.project_id
  role    = "roles/cloudfunctions.invoker"
  member  = "serviceAccount:${google_service_account.tasks_sa.email}"
}

# IAM binding for Next.js service account to create tasks
resource "google_project_iam_member" "nextjs_tasks_enqueuer" {
  project = var.project_id
  role    = "roles/cloudtasks.enqueuer"
  member  = "serviceAccount:${var.archive_service_account_email}"
}

# Create Cloud Storage bucket for function source
resource "google_storage_bucket" "function_source" {
  name                        = "${var.project_id}-gcd-calculator-source-${local.resource_suffix}"
  location                    = var.region
  force_destroy               = true
  uniform_bucket_level_access = true

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      age = 30
    }
    action {
      type = "Delete"
    }
  }
}

# Create archive of cloud function source
data "archive_file" "function_source" {
  type        = "zip"
  output_path = "/tmp/gcd-calculator-function-${terraform.workspace}.zip"
  source_dir  = "../cloudFunctions/calculate_gcd"
  excludes = [
    "__pycache__",
    "*.pyc",
    ".git",
  ]
}

# Upload function source to bucket
resource "google_storage_bucket_object" "function_source" {
  name   = "gcd-calculator-function-${terraform.workspace}-${data.archive_file.function_source.output_md5}.zip"
  bucket = google_storage_bucket.function_source.name
  source = data.archive_file.function_source.output_path

  depends_on = [data.archive_file.function_source]
}

# Create the Cloud Function
resource "google_cloudfunctions2_function" "gcd_calculator" {
  name        = "gcd-calculator-${local.resource_suffix}"
  location    = var.region
  description = "gcd modulus calculator function for ${terraform.workspace} workspace"

  build_config {
    runtime     = "python311"
    entry_point = "calculate_gcd"
    source {
      storage_source {
        bucket = google_storage_bucket.function_source.name
        object = google_storage_bucket_object.function_source.name
      }
    }
  }

  service_config {
    max_instance_count               = 100
    min_instance_count               = 1
    available_memory                 = "1Gi"
    timeout_seconds                  = 300
    max_instance_request_concurrency = 80
    available_cpu                    = "1"

    environment_variables = {
      ENVIRONMENT         = local.environment
      TERRAFORM_WORKSPACE = terraform.workspace
    }

    ingress_settings               = "ALLOW_INTERNAL_AND_GCLB"
    all_traffic_on_latest_revision = true
    service_account_email          = google_service_account.function_sa.email
  }

  depends_on = [
    google_project_service.required_apis,
    google_storage_bucket_object.function_source
  ]
}

resource "random_id" "queue_suffix" {
  byte_length = 2
}

# Create Cloud Tasks queue
resource "google_cloud_tasks_queue" "gcd_calculator_queue" {
  name     = "gcd-calculator-queue-${local.resource_suffix}-${random_id.queue_suffix.hex}"
  location = var.region

  rate_limits {
    max_concurrent_dispatches = 100
    max_dispatches_per_second = 10
  }

  retry_config {
    max_attempts       = 3
    max_retry_duration = "300s"
    max_backoff        = "60s"
    min_backoff        = "5s"
    max_doublings      = 3
  }

  depends_on = [google_project_service.required_apis]
}

# IAM policy to allow tasks service account to invoke the function
resource "google_cloudfunctions2_function_iam_member" "tasks_invoker" {
  project        = var.project_id
  location       = google_cloudfunctions2_function.gcd_calculator.location
  cloud_function = google_cloudfunctions2_function.gcd_calculator.name
  role           = "roles/cloudfunctions.invoker"
  member         = "serviceAccount:${google_service_account.tasks_sa.email}"
}

data "google_cloud_run_service" "function_service" {
  name     = google_cloudfunctions2_function.gcd_calculator.name
  location = google_cloudfunctions2_function.gcd_calculator.location

  depends_on = [google_cloudfunctions2_function.gcd_calculator]
}

# Grant Cloud Run invoker permission to the underlying Cloud Run service
resource "google_cloud_run_service_iam_member" "function_run_invoker" {
  location = data.google_cloud_run_service.function_service.location
  project  = var.project_id
  service  = data.google_cloud_run_service.function_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.tasks_sa.email}"
}

# ── Artifact Registry ─────────────────────────────────────────────────────────

resource "google_artifact_registry_repository" "archive" {
  project       = var.project_id
  location      = var.region
  repository_id = "archive"
  description   = "Docker images for archive.zk.email"
  format        = "DOCKER"

  depends_on = [google_project_service.required_apis]
}

# ── Service account for the Next.js Cloud Run service ─────────────────────────

resource "google_service_account" "archive_app_sa" {
  account_id   = "archive-app-${local.suffix}"
  display_name = "Archive Next.js App (${terraform.workspace})"
  project      = var.project_id
}

resource "google_project_iam_member" "archive_app_sa_roles" {
  for_each = toset([
    "roles/cloudsql.client",
    "roles/cloudtasks.enqueuer",
    "roles/secretmanager.secretAccessor",
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.archive_app_sa.email}"
}

# ── Secret Manager ────────────────────────────────────────────────────────────

locals {
  secrets = {
    DATABASE_URL                 = "postgresql://${var.cloud_sql_db_user}:${var.db_password}@/${var.cloud_sql_db_name}?host=/cloudsql/${var.cloud_sql_instance}"
    AUTH_GOOGLE_ID               = var.auth_google_id
    AUTH_GOOGLE_SECRET           = var.auth_google_secret
    AUTH_SECRET                  = var.auth_secret
    CRON_SECRET                  = var.cron_secret
    WITNESS_API_KEY              = var.witness_api_key
    NEXT_PUBLIC_POSTHOG_KEY      = var.posthog_key
    GOOGLE_CLOUD_PROJECT_ID      = var.project_id
    GOOGLE_CLOUD_REGION          = var.region
    CLOUD_TASKS_QUEUE_NAME       = google_cloud_tasks_queue.gcd_calculator_queue.name
    CLOUD_FUNCTION_URL           = google_cloudfunctions2_function.gcd_calculator.service_config[0].uri
    TASKS_SERVICE_ACCOUNT_EMAIL  = google_service_account.tasks_sa.email
  }
}

resource "google_secret_manager_secret" "archive_secrets" {
  for_each  = local.secrets
  project   = var.project_id
  secret_id = "archive-${lower(replace(each.key, "_", "-"))}-${local.suffix}"

  replication {
    auto {}
  }

  depends_on = [google_project_service.required_apis]
}

resource "google_secret_manager_secret_version" "archive_secrets" {
  for_each    = local.secrets
  secret      = google_secret_manager_secret.archive_secrets[each.key].id
  secret_data = each.value
}

# ── Cloud Run (Next.js app) ───────────────────────────────────────────────────

locals {
  image = "${var.region}-docker.pkg.dev/${var.project_id}/archive/archive:${var.image_tag}"

  # Build env list from secrets for Cloud Run
  secret_env_vars = [
    for k, v in local.secrets : {
      name = k
      value_source = {
        secret_key_ref = {
          secret  = google_secret_manager_secret.archive_secrets[k].secret_id
          version = "latest"
        }
      }
    }
  ]
}

resource "google_cloud_run_v2_service" "archive" {
  name     = "archive-${local.suffix}"
  location = var.region
  project  = var.project_id

  deletion_protection = false

  template {
    service_account = google_service_account.archive_app_sa.email

    scaling {
      min_instance_count = 1
      max_instance_count = 10
    }

    containers {
      image = local.image

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
        startup_cpu_boost = true
      }

      # Cloud SQL socket mount
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      # Public build-time env vars (not secrets)
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "NEXT_PUBLIC_GOOGLE_CLIENT_ID"
        value = var.next_public_google_client_id
      }
      env {
        name  = "NEXT_PUBLIC_POSTHOG_HOST"
        value = "https://us.i.posthog.com"
      }
      env {
        name  = "NEXTAUTH_URL"
        value = local.suffix == "prod" ? "https://archive.zk.email" : "https://staging.archive.zk.email"
      }

      # All secrets injected as env vars
      dynamic "env" {
        for_each = local.secrets
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.archive_secrets[env.key].secret_id
              version = "latest"
            }
          }
        }
      }

      liveness_probe {
        http_get {
          path = "/api/health"
        }
        initial_delay_seconds = 10
        period_seconds        = 30
      }

      startup_probe {
        http_get {
          path = "/api/health"
        }
        initial_delay_seconds = 5
        period_seconds        = 5
        failure_threshold     = 10
      }
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [var.cloud_sql_instance]
      }
    }
  }

  depends_on = [
    google_project_service.required_apis,
    google_secret_manager_secret_version.archive_secrets,
    google_artifact_registry_repository.archive,
    google_project_iam_member.archive_app_sa_roles,
  ]
}

# Allow unauthenticated traffic to Cloud Run
resource "google_cloud_run_v2_service_iam_member" "archive_public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.archive.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ── Cloud Scheduler (stats cache refresh) ─────────────────────────────────────

resource "google_service_account" "scheduler_sa" {
  account_id   = "scheduler-${local.suffix}"
  display_name = "Cloud Scheduler for archive stats (${terraform.workspace})"
  project      = var.project_id
}

resource "google_cloud_run_v2_service_iam_member" "scheduler_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.archive.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler_sa.email}"
}

resource "google_cloud_scheduler_job" "refresh_stats" {
  name             = "archive-refresh-stats-${local.suffix}"
  description      = "Refresh StatsCache every 6 hours"
  schedule         = "0 */6 * * *"
  time_zone        = "UTC"
  project          = var.project_id
  region           = var.region
  attempt_deadline = "320s"

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.archive.uri}/api/stats"

    headers = {
      "Authorization" = "Bearer ${var.cron_secret}"
      "Content-Type"  = "application/json"
    }

    oidc_token {
      service_account_email = google_service_account.scheduler_sa.email
    }
  }

  depends_on = [
    google_project_service.required_apis,
    google_cloud_run_v2_service.archive,
  ]
}