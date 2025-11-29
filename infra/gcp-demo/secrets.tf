resource "random_password" "session_secret" {
  length  = 48
  special = false
}

resource "random_password" "demo_admin" {
  length  = 32
  special = false
}

resource "random_password" "demo_service" {
  length  = 32
  special = false
}

resource "random_password" "demo_viewer" {
  length  = 32
  special = false
}

locals {
  secret_values = {
    APPHUB_SESSION_SECRET     = var.apphub_session_secret != "" ? var.apphub_session_secret : random_password.session_secret.result
    APPHUB_DEMO_ADMIN_TOKEN   = var.apphub_demo_admin_token != "" ? var.apphub_demo_admin_token : random_password.demo_admin.result
    APPHUB_DEMO_SERVICE_TOKEN = var.apphub_demo_service_token != "" ? var.apphub_demo_service_token : random_password.demo_service.result
    APPHUB_DEMO_VIEWER_TOKEN  = var.apphub_demo_viewer_token != "" ? var.apphub_demo_viewer_token : random_password.demo_viewer.result
  }

  secret_map = {
    "apphub-session-secret"     = local.secret_values.APPHUB_SESSION_SECRET
    "apphub-demo-admin-token"   = local.secret_values.APPHUB_DEMO_ADMIN_TOKEN
    "apphub-demo-service-token" = local.secret_values.APPHUB_DEMO_SERVICE_TOKEN
    "apphub-demo-viewer-token"  = local.secret_values.APPHUB_DEMO_VIEWER_TOKEN
  }
}

resource "google_secret_manager_secret" "apphub" {
  for_each = local.secret_map

  secret_id = each.key
  replication {
    auto {}
  }

  labels = local.common_labels

  depends_on = [google_project_service.enabled]
}

resource "google_secret_manager_secret_version" "apphub" {
  for_each = google_secret_manager_secret.apphub

  secret      = each.value.id
  secret_data = local.secret_map[each.key]
}
