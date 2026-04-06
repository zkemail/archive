variable "project_id" {
  description = "The GCP project ID"
  type        = string
}

variable "region" {
  description = "The GCP region"
  type        = string
  default     = "us-central1"
}

variable "environment" {
  description = "Environment (dev, staging, prod)"
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be one of: dev, staging, prod."
  }
}

variable "archive_service_account_email" {
  description = "Service account email for the Next.js application (leave empty to create a new one)"
  type        = string
  default     = ""
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
  default     = "dkimdb"
}

variable "image_tag" {
  description = "Docker image tag to deploy"
  type        = string
  default     = "latest"
}

# Secrets - passed in via tfvars or CI environment, never committed
variable "db_password" {
  description = "Cloud SQL database password"
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
  description = "NextAuth secret (AUTH_SECRET)"
  type        = string
  sensitive   = true
}

variable "cron_secret" {
  description = "Bearer token for POST /api/stats (CRON_SECRET)"
  type        = string
  sensitive   = true
}

variable "witness_api_key" {
  description = "Witness.co API key (WITNESS_API_KEY)"
  type        = string
  sensitive   = true
  default     = ""
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
