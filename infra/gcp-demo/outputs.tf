output "project_id" {
  description = "Project ID used for this deployment"
  value       = local.project_id
}

output "demo_fqdn" {
  description = "Public hostname for the demo stack"
  value       = local.demo_fqdn
}

output "demo_public_ip" {
  description = "Static IP attached to the demo VM"
  value       = google_compute_address.demo.address
}

output "demo_instance_name" {
  description = "GCE instance name for the demo VM"
  value       = google_compute_instance.demo.name
}

output "demo_zone" {
  description = "Zone used for the demo VM"
  value       = google_compute_instance.demo.zone
}

output "website_fqdn" {
  description = "Public hostname for the marketing site"
  value       = local.website_fqdn
}

output "website_bucket" {
  description = "GCS bucket hosting the marketing build"
  value       = google_storage_bucket.website.name
}

output "website_url_map_name" {
  description = "URL map to invalidate for Cloud CDN cache clears"
  value       = google_compute_url_map.website_https.name
}

output "website_global_ip" {
  description = "Global IP for the marketing load balancer"
  value       = google_compute_global_address.website.address
}

output "cloud_dns_nameservers" {
  description = "Cloud DNS nameservers to configure at the registrar"
  value       = var.enable_managed_dns ? google_dns_managed_zone.primary[0].name_servers : []
}

output "secret_ids" {
  description = "Secret Manager IDs for demo credentials"
  value = {
    session = google_secret_manager_secret.apphub["apphub-session-secret"].secret_id
    admin   = google_secret_manager_secret.apphub["apphub-demo-admin-token"].secret_id
    service = google_secret_manager_secret.apphub["apphub-demo-service-token"].secret_id
    viewer  = google_secret_manager_secret.apphub["apphub-demo-viewer-token"].secret_id
  }
  sensitive = true
}
