# ZK Email Archive - Terraform Infrastructure
# This configuration manages GCP resources for the Archive application

terraform {
  required_version = ">= 1.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  backend "gcs" {
    bucket = "archive-terraform-state"
    prefix = "terraform/state"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Enable required APIs
resource "google_project_service" "apis" {
  for_each = toset([
    "cloudfunctions.googleapis.com",
    "cloudtasks.googleapis.com",
    "cloudbuild.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
  ])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# Cloud Tasks Queue for GCD calculations
resource "google_cloud_tasks_queue" "gcd_queue" {
  name     = var.cloud_tasks_queue_name
  location = var.region

  rate_limits {
    max_concurrent_dispatches = 10
    max_dispatches_per_second = 5
  }

  retry_config {
    max_attempts       = 5
    max_retry_duration = "3600s"
    min_backoff        = "10s"
    max_backoff        = "300s"
    max_doublings      = 4
  }

  depends_on = [google_project_service.apis["cloudtasks.googleapis.com"]]
}

# Service Account for Cloud Tasks
resource "google_service_account" "tasks_invoker" {
  account_id   = "archive-tasks-invoker"
  display_name = "Archive Cloud Tasks Invoker"
  description  = "Service account for invoking Cloud Functions from Cloud Tasks"
}

# IAM binding for Cloud Tasks to invoke Cloud Functions
resource "google_cloud_run_service_iam_member" "tasks_invoker" {
  count    = var.cloud_function_name != "" ? 1 : 0
  location = var.region
  service  = var.cloud_function_name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.tasks_invoker.email}"
}

# Secret Manager secrets
resource "google_secret_manager_secret" "cron_secret" {
  secret_id = "archive-cron-secret"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret" "nextauth_secret" {
  secret_id = "archive-nextauth-secret"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis["secretmanager.googleapis.com"]]
}

# Output values
output "cloud_tasks_queue_name" {
  value       = google_cloud_tasks_queue.gcd_queue.name
  description = "Name of the Cloud Tasks queue"
}

output "tasks_service_account_email" {
  value       = google_service_account.tasks_invoker.email
  description = "Email of the tasks invoker service account"
}
