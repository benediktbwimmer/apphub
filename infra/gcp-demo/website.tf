resource "random_id" "website" {
  byte_length = 4
}

locals {
  website_bucket_name = "${replace(var.domain_name, ".", "-")}-${random_id.website.hex}"
}

resource "google_storage_bucket" "website" {
  name     = local.website_bucket_name
  location = upper(local.region)

  force_destroy               = true
  uniform_bucket_level_access = true
  storage_class               = "STANDARD"
  public_access_prevention    = "inherited"

  labels = local.common_labels

  depends_on = [google_project_service.enabled]
}

resource "google_storage_bucket_iam_member" "public" {
  bucket = google_storage_bucket.website.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

resource "google_compute_backend_bucket" "website" {
  name        = "${local.project_name}-website-backend"
  bucket_name = google_storage_bucket.website.name
  enable_cdn  = true

  depends_on = [google_project_service.enabled]
}

resource "google_compute_url_map" "website_https" {
  name            = "${local.project_name}-website-https"
  default_service = google_compute_backend_bucket.website.id

  host_rule {
    hosts        = ["*"]
    path_matcher = "all"
  }

  path_matcher {
    name            = "all"
    default_service = google_compute_backend_bucket.website.id

    route_rules {
      priority = 1

      match_rules {
        full_path_match = "/"
      }

      route_action {
        url_rewrite {
          path_prefix_rewrite = "/index.html"
        }
      }

      service = google_compute_backend_bucket.website.id
    }
  }
}

resource "google_compute_managed_ssl_certificate" "website" {
  count = var.enable_managed_dns ? 1 : 0

  name = "${local.project_name}-website-cert-${random_id.website.hex}"

  managed {
    domains = local.website_domains
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_compute_target_https_proxy" "website" {
  count = var.enable_managed_dns ? 1 : 0

  name             = "${local.project_name}-https-proxy"
  url_map          = google_compute_url_map.website_https.id
  ssl_certificates = [google_compute_managed_ssl_certificate.website[0].id]
}

resource "google_compute_url_map" "website_http_redirect" {
  count = var.enable_managed_dns ? 1 : 0

  name = "${local.project_name}-website-redirect"

  default_url_redirect {
    https_redirect         = true
    strip_query            = false
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
  }
}

resource "google_compute_target_http_proxy" "website_redirect" {
  count = var.enable_managed_dns ? 1 : 0

  name    = "${local.project_name}-http-redirect"
  url_map = google_compute_url_map.website_http_redirect[0].id
}

resource "google_compute_target_http_proxy" "website_http" {
  count = var.enable_managed_dns ? 0 : 1

  name    = "${local.project_name}-http-proxy"
  url_map = google_compute_url_map.website_https.id
}

resource "google_compute_global_address" "website" {
  name = "${local.project_name}-website-ip"

  depends_on = [google_project_service.enabled]
}

resource "google_compute_global_forwarding_rule" "website_https" {
  count = var.enable_managed_dns ? 1 : 0

  name       = "${local.project_name}-https-forwarding"
  ip_address = google_compute_global_address.website.address
  port_range = "443"
  target     = google_compute_target_https_proxy.website[0].id
}

resource "google_compute_global_forwarding_rule" "website_http_redirect" {
  count = var.enable_managed_dns ? 1 : 0

  name       = "${local.project_name}-http-redirect"
  ip_address = google_compute_global_address.website.address
  port_range = "80"
  target     = google_compute_target_http_proxy.website_redirect[0].id
}

resource "google_compute_global_forwarding_rule" "website_http" {
  count = var.enable_managed_dns ? 0 : 1

  name       = "${local.project_name}-http-forwarding"
  ip_address = google_compute_global_address.website.address
  port_range = "80"
  target     = google_compute_target_http_proxy.website_http[0].id
}
