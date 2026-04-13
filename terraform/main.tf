terraform {
  required_version = ">= 1.0"

  backend "gcs" {
    bucket = "terraform-state-archive"
    prefix = "terraform/state"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

# Workspace-specific config — use `terraform workspace select main` for prod
locals {
  workspace_config = {
    "pr-validation" = {
      environment = "staging"
      suffix      = "pr-validation"
    }
    "main" = {
      environment = "prod"
      suffix      = "main"
    }
  }

  current_config = local.workspace_config[terraform.workspace]
  environment    = local.current_config.environment
  # suffix matches workspace name so secret IDs align with what CI passes to gcloud
  suffix = local.current_config.suffix
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Enable only the APIs this terraform actually manages
resource "google_project_service" "required_apis" {
  for_each = toset([
    "artifactregistry.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudscheduler.googleapis.com",
    "sqladmin.googleapis.com",
  ])

  service                    = each.value
  disable_dependent_services = false
  disable_on_destroy         = false
}

# ── Reference existing service accounts (no creation) ─────────────────────────
# archive-sa@zkairdrop — the Cloud Run app identity (has cloudsql.client, cloudtasks.enqueuer, etc.)
data "google_service_account" "archive_app_sa" {
  account_id = "archive-sa"
  project    = var.project_id
}

# ── Artifact Registry ─────────────────────────────────────────────────────────
# Creates the 'archive' repository in the project if it doesn't exist.
# CI pushes to: {region}-docker.pkg.dev/{project}/archive/archive
resource "google_artifact_registry_repository" "archive" {
  project       = var.project_id
  location      = var.region
  repository_id = "archive"
  description   = "Docker images for archive.zk.email"
  format        = "DOCKER"

  depends_on = [google_project_service.required_apis]
}

# ── Secret Manager ────────────────────────────────────────────────────────────
# Secret IDs must match what deploy.yml passes via --update-secrets:
#   archive-database-url-{workspace}, archive-auth-google-id-{workspace}, …
locals {
  secrets = {
    "archive-database-url-${local.suffix}"                = "postgresql://${var.cloud_sql_db_user}:${var.db_password}@/${var.cloud_sql_db_name}?host=/cloudsql/${var.cloud_sql_instance}"
    "archive-auth-google-id-${local.suffix}"              = var.auth_google_id
    "archive-auth-google-secret-${local.suffix}"          = var.auth_google_secret
    "archive-auth-secret-${local.suffix}"                 = var.auth_secret
    "archive-cron-secret-${local.suffix}"                 = var.cron_secret
    "archive-cloud-tasks-queue-name-${local.suffix}"      = var.cloud_tasks_queue_name
    "archive-cloud-function-url-${local.suffix}"          = var.cloud_function_url
    "archive-tasks-service-account-email-${local.suffix}" = var.tasks_service_account_email
  }
}

resource "google_secret_manager_secret" "archive_secrets" {
  for_each  = local.secrets
  project   = var.project_id
  secret_id = each.key

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

  service_name = "archive-${local.suffix == "main" ? "prod" : "pr"}"
  nextauth_url = local.suffix == "main" ? "https://archive.zk.email" : "https://staging.archive.zk.email"
}

resource "google_cloud_run_v2_service" "archive" {
  name     = local.service_name
  location = var.region
  project  = var.project_id

  deletion_protection = false

  template {
    service_account = data.google_service_account.archive_app_sa.email

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

      # Non-secret env vars
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "AUTH_TRUST_HOST"
        value = "true"
      }
      env {
        name  = "AUTH_URL"
        value = local.nextauth_url
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
        name  = "GOOGLE_CLOUD_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "GOOGLE_CLOUD_REGION"
        value = var.region
      }

      # Secrets injected by name — must match local.secrets keys above
      dynamic "env" {
        for_each = {
          DATABASE_URL                 = "archive-database-url-${local.suffix}"
          AUTH_GOOGLE_ID               = "archive-auth-google-id-${local.suffix}"
          AUTH_GOOGLE_SECRET           = "archive-auth-google-secret-${local.suffix}"
          AUTH_SECRET                  = "archive-auth-secret-${local.suffix}"
          CRON_SECRET                  = "archive-cron-secret-${local.suffix}"
          CLOUD_TASKS_QUEUE_NAME       = "archive-cloud-tasks-queue-name-${local.suffix}"
          CLOUD_FUNCTION_URL           = "archive-cloud-function-url-${local.suffix}"
          TASKS_SERVICE_ACCOUNT_EMAIL  = "archive-tasks-service-account-email-${local.suffix}"
        }
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.archive_secrets[env.value].secret_id
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
  ]
}

# Allow unauthenticated traffic
resource "google_cloud_run_v2_service_iam_member" "archive_public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.archive.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ── Cloud Scheduler (stats cache refresh every 6 h) ──────────────────────────
resource "google_service_account" "scheduler_sa" {
  account_id   = "archive-scheduler-${local.suffix}"
  display_name = "Cloud Scheduler → archive stats (${terraform.workspace})"
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
      "Content-Type" = "application/json"
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
