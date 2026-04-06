output "GOOGLE_CLOUD_PROJECT_ID" {
  value = var.project_id
}

output "GOOGLE_CLOUD_REGION" {
  value = var.region
}

output "CLOUD_TASKS_QUEUE_NAME" {
  value = google_cloud_tasks_queue.gcd_calculator_queue.name
}

output "CLOUD_FUNCTION_URL" {
  value = google_cloudfunctions2_function.gcd_calculator.service_config[0].uri
}

output "TASKS_SERVICE_ACCOUNT_EMAIL" {
  value = google_service_account.tasks_sa.email
}

output "cloud_run_url" {
  description = "Cloud Run service URL"
  value       = google_cloud_run_v2_service.archive.uri
}

output "artifact_registry_image_base" {
  description = "Base image path for pushing Docker images"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/archive/archive"
}

output "archive_app_service_account" {
  description = "Service account email of the Cloud Run app (use in terraform.tfvars as archive_service_account_email)"
  value       = google_service_account.archive_app_sa.email
}