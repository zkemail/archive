# Workload Identity Federation for GitHub Actions
# Allows the GitHub Actions workflow to authenticate to GCP without storing a long-lived key.

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "github-actions-${local.suffix}"
  display_name              = "GitHub Actions (${terraform.workspace})"

  depends_on = [google_project_service.required_apis]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-provider"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.actor"      = "assertion.actor"
    "attribute.repository" = "assertion.repository"
  }

  attribute_condition = "assertion.repository == 'zkemail/archive'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# Dedicated deploy service account
resource "google_service_account" "github_deploy_sa" {
  account_id   = "github-deploy-${local.suffix}"
  display_name = "GitHub Actions Deploy SA (${terraform.workspace})"
  project      = var.project_id
}

# Allow GitHub Actions to impersonate this SA
resource "google_service_account_iam_member" "github_wif_binding" {
  service_account_id = google_service_account.github_deploy_sa.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/zkemail/archive"
}

# Permissions the deploy SA needs
resource "google_project_iam_member" "github_deploy_roles" {
  for_each = toset([
    "roles/run.admin",
    "roles/artifactregistry.writer",
    "roles/secretmanager.secretAccessor",
    "roles/cloudsql.client",
    "roles/iam.serviceAccountUser",   # to act as the Cloud Run service account
    "roles/storage.objectViewer",     # to pull terraform state from GCS
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.github_deploy_sa.email}"
}

# ── Outputs for GitHub Actions secrets setup ──────────────────────────────────

output "GCP_WORKLOAD_IDENTITY_PROVIDER" {
  description = "Set this as GCP_WORKLOAD_IDENTITY_PROVIDER in GitHub Actions secrets"
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "GCP_DEPLOY_SERVICE_ACCOUNT" {
  description = "Set this as GCP_DEPLOY_SERVICE_ACCOUNT in GitHub Actions secrets"
  value       = google_service_account.github_deploy_sa.email
}

output "GCP_CLOUD_RUN_SERVICE_ACCOUNT" {
  description = "Set this as GCP_CLOUD_RUN_SERVICE_ACCOUNT in GitHub Actions secrets"
  value       = google_service_account.archive_app_sa.email
}
