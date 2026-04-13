output "cloud_run_url" {
  description = "Cloud Run service URL"
  value       = google_cloud_run_v2_service.archive.uri
}

output "artifact_registry_image_base" {
  description = "Base image path for pushing Docker images"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/archive/archive"
}

output "archive_app_service_account" {
  description = "Service account email of the Cloud Run app"
  value       = data.google_service_account.archive_app_sa.email
}
