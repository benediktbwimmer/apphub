output "demo_endpoint" {
  description = "Public URL for the demo stack"
  value       = local.demo_fqdn
}

output "website_endpoint" {
  description = "Public URL for the marketing site"
  value       = local.website_fqdn
}

output "ec2_public_ip" {
  description = "Elastic IP attached to the demo EC2 instance"
  value       = aws_eip.demo.public_ip
}

output "route53_nameservers" {
  description = "Nameservers to configure at GoDaddy for the hosted zone"
  value       = aws_route53_zone.primary.name_servers
}

output "cloudfront_domain" {
  description = "CloudFront distribution domain for the marketing site"
  value       = length(aws_cloudfront_distribution.website) > 0 ? aws_cloudfront_distribution.website[0].domain_name : null
}

output "website_bucket" {
  description = "S3 bucket name that hosts the marketing build"
  value       = aws_s3_bucket.website.bucket
}

output "website_distribution_id" {
  description = "CloudFront distribution ID for cache invalidations"
  value       = length(aws_cloudfront_distribution.website) > 0 ? aws_cloudfront_distribution.website[0].id : null
}
