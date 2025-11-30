locals {
  zone = var.zone != "" ? var.zone : "${var.region}-b"

  env_base = templatefile("${path.module}/templates/env.base.tmpl", {
    demo_fqdn          = local.demo_fqdn
    enable_managed_dns = var.enable_managed_dns
  })

  caddyfile = templatefile("${path.module}/templates/Caddyfile.tmpl", {
    demo_fqdn     = local.demo_fqdn
    contact_email = var.contact_email
  })

  compose_override = file("${path.module}/config/docker-compose.override.yml")

  startup_script = templatefile("${path.module}/templates/startup.sh.tmpl", {
    project_id         = local.project_id
    region             = local.region
    demo_fqdn          = local.demo_fqdn
    apphub_git_repo    = var.apphub_git_repo
    apphub_git_ref     = var.apphub_git_ref
    contact_email      = var.contact_email
    env_base           = local.env_base
    caddyfile          = local.caddyfile
    compose_override   = local.compose_override
    enable_managed_dns = var.enable_managed_dns
    session_secret     = google_secret_manager_secret.apphub["apphub-session-secret"].id
    admin_token        = google_secret_manager_secret.apphub["apphub-demo-admin-token"].id
    service_token      = google_secret_manager_secret.apphub["apphub-demo-service-token"].id
    viewer_token       = google_secret_manager_secret.apphub["apphub-demo-viewer-token"].id
  })
}

resource "google_service_account" "demo" {
  account_id   = "${replace(lower(local.project_name), "[^a-z0-9]", "-")}-vm"
  display_name = "AppHub demo VM"

  depends_on = [google_project_service.enabled]
}

resource "google_project_iam_member" "demo_logging" {
  project = local.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.demo.email}"
}

resource "google_project_iam_member" "demo_monitoring" {
  project = local.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.demo.email}"
}

resource "google_project_iam_member" "demo_secret_access" {
  project = local.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.demo.email}"
}

resource "google_compute_address" "demo" {
  name   = "${local.project_name}-demo-ip"
  region = local.region

  depends_on = [google_project_service.enabled]
}

resource "google_compute_instance" "demo" {
  name         = "${local.project_name}-vm"
  machine_type = var.machine_type
  zone         = local.zone
  tags         = ["apphub-demo"]

  boot_disk {
    initialize_params {
      image = var.boot_disk_image
      size  = var.boot_disk_gb
      type  = "pd-ssd"
      labels = {
        project     = local.project_name
        environment = "demo"
      }
    }
  }

  network_interface {
    subnetwork = google_compute_subnetwork.demo.id
    access_config {
      nat_ip = google_compute_address.demo.address
    }
  }

  service_account {
    email  = google_service_account.demo.email
    scopes = ["https://www.googleapis.com/auth/cloud-platform"]
  }

  metadata = merge(
    var.ssh_public_key != "" ? {
      ssh-keys = "apphub:${var.ssh_public_key}"
    } : {},
    {
      enable-oslogin = "FALSE"
    }
  )

  metadata_startup_script = local.startup_script

  labels = local.common_labels

  depends_on = [
    google_project_service.enabled,
    google_secret_manager_secret.apphub
  ]
}
