# ZK Email Archive - Terraform Variables

variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for resources"
  type        = string
  default     = "us-central1"
}

variable "environment" {
  description = "Environment name (production, staging, development)"
  type        = string
  default     = "production"

  validation {
    condition     = contains(["production", "staging", "development"], var.environment)
    error_message = "Environment must be one of: production, staging, development."
  }
}

variable "cloud_tasks_queue_name" {
  description = "Name for the Cloud Tasks queue"
  type        = string
  default     = "archive-gcd-queue"
}

variable "cloud_function_name" {
  description = "Name of the Cloud Function to invoke (Cloud Run service name)"
  type        = string
  default     = ""
}

variable "app_url" {
  description = "URL of the deployed Archive application"
  type        = string
  default     = ""
}

variable "database_connection_name" {
  description = "Cloud SQL connection name for the database"
  type        = string
  default     = ""
}
