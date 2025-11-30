terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.11"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

data "google_client_config" "current" {}

locals {
  project_id   = coalesce(var.project_id, data.google_client_config.current.project)
  project_name = var.project_name
  region       = var.region

  demo_fqdn    = var.demo_subdomain == "" ? var.domain_name : "${var.demo_subdomain}.${var.domain_name}"
  website_fqdn = var.website_subdomain == "" ? var.domain_name : "${var.website_subdomain}.${var.domain_name}"

  website_domains = distinct(
    compact([
      var.domain_name,
      local.website_fqdn
    ])
  )

  common_labels = {
    project     = local.project_name
    environment = "demo"
    managed_by  = "terraform"
  }

  required_services = concat(
    [
      "compute.googleapis.com",
      "secretmanager.googleapis.com",
      "storage.googleapis.com",
      "logging.googleapis.com",
      "monitoring.googleapis.com",
      "iam.googleapis.com",
      "cloudresourcemanager.googleapis.com"
    ],
    var.enable_managed_dns ? ["dns.googleapis.com"] : []
  )

  billing_services = var.billing_account_id == "" ? [] : ["billingbudgets.googleapis.com"]
}

provider "google" {
  project = var.project_id != null ? var.project_id : null
  region  = local.region
}

resource "google_project_service" "enabled" {
  for_each           = toset(local.required_services)
  service            = each.key
  disable_on_destroy = false
}

resource "google_project_service" "billing" {
  for_each           = toset(local.billing_services)
  service            = each.key
  disable_on_destroy = false
}
