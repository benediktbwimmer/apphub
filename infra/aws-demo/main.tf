terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

locals {
  project_name = var.project_name

  common_tags = {
    Project     = local.project_name
    Environment = "demo"
    ManagedBy   = "terraform"
  }

  demo_fqdn    = var.demo_subdomain == "" ? var.domain_name : "${var.demo_subdomain}.${var.domain_name}"
  website_fqdn = var.website_subdomain == "" ? var.domain_name : "${var.website_subdomain}.${var.domain_name}"
}

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}
