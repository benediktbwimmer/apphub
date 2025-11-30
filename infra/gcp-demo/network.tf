resource "google_compute_network" "demo" {
  name                    = "${local.project_name}-vpc"
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"

  depends_on = [google_project_service.enabled]
}

resource "google_compute_subnetwork" "demo" {
  name          = "${local.project_name}-subnet"
  region        = local.region
  network       = google_compute_network.demo.id
  ip_cidr_range = "10.40.0.0/20"

  depends_on = [google_project_service.enabled]
}

resource "google_compute_firewall" "ssh" {
  name        = "${local.project_name}-ssh"
  network     = google_compute_network.demo.id
  description = "SSH access to AppHub demo VM"
  priority    = 1000
  direction   = "INGRESS"

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = var.admin_cidr_blocks
  target_tags   = ["apphub-demo"]
}

resource "google_compute_firewall" "web" {
  name        = "${local.project_name}-web"
  network     = google_compute_network.demo.id
  description = "HTTP/HTTPS access for AppHub demo"
  priority    = 1000
  direction   = "INGRESS"

  allow {
    protocol = "tcp"
    ports    = ["80", "443", "4000", "4173"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["apphub-demo"]
}

resource "google_compute_firewall" "egress" {
  name        = "${local.project_name}-egress"
  network     = google_compute_network.demo.id
  description = "Allow all egress"
  priority    = 1000
  direction   = "EGRESS"

  allow {
    protocol = "all"
  }

  destination_ranges = ["0.0.0.0/0"]
  target_tags        = ["apphub-demo"]
}
