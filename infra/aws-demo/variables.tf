variable "project_name" {
  type        = string
  description = "Name tag prefix applied to created resources"
  default     = "apphub-demo"
}

variable "aws_region" {
  type        = string
  description = "AWS region for the demo stack"
  default     = "eu-central-1"
}

variable "domain_name" {
  type        = string
  description = "Root domain to manage via Route53 (must match the GoDaddy domain)"
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
  description = "CIDR blocks allowed to SSH into the EC2 instance"
  default     = ["0.0.0.0/0"]
}

variable "instance_type" {
  type        = string
  description = "Instance type for the demo stack EC2 host"
  default     = "t3a.large"
}

variable "root_volume_size_gb" {
  type        = number
  description = "Root EBS volume size for the EC2 instance in GiB"
  default     = 50
}

variable "ssh_public_key" {
  type        = string
  description = "Public SSH key material for the EC2 key pair"
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
}

variable "apphub_demo_admin_token" {
  type        = string
  description = "Admin token for the demo stack"
  sensitive   = true
}

variable "apphub_demo_service_token" {
  type        = string
  description = "Service token for the demo stack"
  sensitive   = true
}

variable "apphub_demo_viewer_token" {
  type        = string
  description = "Viewer token for the demo stack"
  sensitive   = true
}

variable "budget_monthly_limit" {
  type        = number
  description = "Monthly cost ceiling in USD for the AWS Budget alert"
  default     = 110
}

variable "contact_email" {
  type        = string
  description = "Email recipient for budget alerts"
}

variable "enable_managed_dns" {
  type        = bool
  description = "Whether to provision CloudFront, ACM, and Route53 records for the marketing site"
  default     = false
}
