variable "project_name" {
  type        = string
  description = "Name prefix applied to created resources"
  default     = "apphub-demo"
}

variable "project_id" {
  type        = string
  description = "GCP project ID (defaults to gcloud config value)"
  default     = null
}

variable "region" {
  type        = string
  description = "Region for regional resources"
  default     = "europe-west1"
}

variable "zone" {
  type        = string
  description = "Zone for the demo VM (defaults to <region>-b)"
  default     = ""
}

variable "domain_name" {
  type        = string
  description = "Root domain for marketing/demo hosts"
  default     = "osiris-apphub.com"
}

variable "demo_subdomain" {
  type        = string
  description = "Subdomain for the demo stack host"
  default     = "demo"
}

variable "website_subdomain" {
  type        = string
  description = "Subdomain for the marketing website"
  default     = "www"
}

variable "admin_cidr_blocks" {
  type        = list(string)
  description = "CIDR blocks allowed to SSH into the demo VM"
  default     = ["0.0.0.0/0"]
}

variable "machine_type" {
  type        = string
  description = "Machine type for the demo VM"
  default     = "e2-standard-2"
}

variable "boot_disk_gb" {
  type        = number
  description = "Boot disk size for the demo VM in GiB"
  default     = 50
}

variable "boot_disk_image" {
  type        = string
  description = "Image for the demo VM boot disk"
  default     = "projects/debian-cloud/global/images/family/debian-12"
}

variable "ssh_public_key" {
  type        = string
  description = "SSH public key material for VM login (optional)"
  default     = ""
}

variable "apphub_git_repo" {
  type        = string
  description = "Git repository URL to clone for the demo stack"
  default     = "https://github.com/benediktbwimmer/apphub.git"
}

variable "apphub_git_ref" {
  type        = string
  description = "Git ref (branch, tag, or commit SHA) to deploy"
  default     = "main"
}

variable "apphub_session_secret" {
  type        = string
  description = "Session secret used by the demo stack"
  sensitive   = true
  default     = ""
}

variable "apphub_demo_admin_token" {
  type        = string
  description = "Admin token for the demo stack"
  sensitive   = true
  default     = ""
}

variable "apphub_demo_service_token" {
  type        = string
  description = "Service token for the demo stack"
  sensitive   = true
  default     = ""
}

variable "apphub_demo_viewer_token" {
  type        = string
  description = "Viewer token for the demo stack"
  sensitive   = true
  default     = ""
}

variable "contact_email" {
  type        = string
  description = "Email recipient for alerts and TLS registrations"
  default     = "ops@osiris-apphub.com"
}

variable "billing_account_id" {
  type        = string
  description = "Billing account for budgets (leave empty to skip budget)"
  default     = ""
}

variable "budget_monthly_limit" {
  type        = number
  description = "Monthly cost ceiling in USD for budget alerts"
  default     = 110
}

variable "enable_managed_dns" {
  type        = bool
  description = "Whether to manage Cloud DNS records and certificates"
  default     = true
}
