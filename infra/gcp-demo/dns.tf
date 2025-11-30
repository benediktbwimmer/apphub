locals {
  dns_zone_name = "${replace(var.domain_name, ".", "-")}-zone"
}

resource "google_dns_managed_zone" "primary" {
  count = var.enable_managed_dns ? 1 : 0

  name        = local.dns_zone_name
  dns_name    = "${var.domain_name}."
  description = "Managed zone for ${var.domain_name}"

  labels = local.common_labels

  depends_on = [google_project_service.enabled]
}

resource "google_dns_record_set" "root_a" {
  count = var.enable_managed_dns ? 1 : 0

  name         = "${var.domain_name}."
  type         = "A"
  ttl          = 60
  managed_zone = google_dns_managed_zone.primary[0].name
  rrdatas      = [google_compute_global_address.website.address]
}

resource "google_dns_record_set" "website_a" {
  count = var.enable_managed_dns && local.website_fqdn != var.domain_name ? 1 : 0

  name         = "${local.website_fqdn}."
  type         = "A"
  ttl          = 60
  managed_zone = google_dns_managed_zone.primary[0].name
  rrdatas      = [google_compute_global_address.website.address]
}

resource "google_dns_record_set" "demo_a" {
  count = var.enable_managed_dns ? 1 : 0

  name         = "${local.demo_fqdn}."
  type         = "A"
  ttl          = 60
  managed_zone = google_dns_managed_zone.primary[0].name
  rrdatas      = [google_compute_address.demo.address]
}
