variable "project_id" {
  description = "The GCP project ID (zkairdrop)"
  type        = string
}

variable "region" {
  description = "The GCP region"
  type        = string
  default     = "us-central1"
}

variable "environment" {
  description = "Environment (staging, prod)"
  type        = string
  default     = "prod"

  validation {
    condition     = contains(["staging", "prod"], var.environment)
    error_message = "Environment must be one of: staging, prod."
  }
}

variable "cloud_sql_instance" {
  description = "Cloud SQL instance connection name (project:region:instance)"
  type        = string
  default     = "zkemail:us-central1:dkimregistry"
}

variable "cloud_sql_db_user" {
  description = "Cloud SQL database username"
  type        = string
  default     = "render"
}

variable "cloud_sql_db_name" {
  description = "Cloud SQL database name"
  type        = string
  default     = "prodduplicate_new_archive"
}

variable "image_tag" {
  description = "Docker image tag to deploy (overridden by CI with git SHA)"
  type        = string
  default     = "latest"
}

# Secrets — never commit real values; pass via CI env vars or local terraform.tfvars
variable "db_password" {
  description = "Cloud SQL database password for the render user"
  type        = string
  sensitive   = true
}

variable "auth_google_id" {
  description = "Google OAuth client ID (AUTH_GOOGLE_ID)"
  type        = string
  sensitive   = true
}

variable "auth_google_secret" {
  description = "Google OAuth client secret (AUTH_GOOGLE_SECRET)"
  type        = string
  sensitive   = true
}

variable "auth_secret" {
  description = "NextAuth secret (AUTH_SECRET) — generate with: openssl rand -base64 32"
  type        = string
  sensitive   = true
}

variable "cron_secret" {
  description = "Bearer token for POST /api/stats (CRON_SECRET) — generate with: openssl rand -base64 32"
  type        = string
  sensitive   = true
}

variable "posthog_key" {
  description = "PostHog project API key (NEXT_PUBLIC_POSTHOG_KEY)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "next_public_google_client_id" {
  description = "Google OAuth client ID for client-side use (NEXT_PUBLIC_GOOGLE_CLIENT_ID)"
  type        = string
  default     = ""
}

# Existing Cloud Tasks / Cloud Functions infra (already deployed in zkairdrop)
variable "cloud_tasks_queue_name" {
  description = "Existing Cloud Tasks queue name for GCD calculator"
  type        = string
}

variable "cloud_function_url" {
  description = "Existing GCD calculator Cloud Function v2 URL"
  type        = string
}

variable "tasks_service_account_email" {
  description = "Service account email used by Cloud Tasks to invoke the GCD function"
  type        = string
}
