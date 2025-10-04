resource "random_id" "website" {
  byte_length = 4
}

locals {
  website_bucket_name = "${replace(var.domain_name, ".", "-")}-${random_id.website.hex}"
}

resource "aws_s3_bucket" "website" {
  bucket = local.website_bucket_name

  tags = merge(local.common_tags, {
    Name = "${local.project_name}-website"
  })
}

resource "aws_s3_bucket_ownership_controls" "website" {
  bucket = aws_s3_bucket.website.id

  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_s3_bucket_public_access_block" "website" {
  bucket                  = aws_s3_bucket.website.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "website" {
  count                             = var.enable_managed_dns ? 1 : 0
  name                              = "${local.project_name}-website-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_response_headers_policy" "website_security" {
  count = var.enable_managed_dns ? 1 : 0
  name  = "${local.project_name}-website-security"

  security_headers_config {
    content_security_policy {
      content_security_policy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self';"
      override                = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }
    xss_protection {
      protection = true
      mode_block = true
      override   = true
    }
  }
}

resource "aws_acm_certificate" "website" {
  count             = var.enable_managed_dns ? 1 : 0
  provider          = aws.us_east_1
  domain_name       = var.domain_name
  validation_method = "DNS"
  subject_alternative_names = [
    local.website_fqdn
  ]

  lifecycle {
    create_before_destroy = true
  }

  tags = merge(local.common_tags, {
    Name = "${local.project_name}-website-cert"
  })
}

resource "aws_route53_record" "certificate_validation" {
  for_each = var.enable_managed_dns ? {
    for dvo in aws_acm_certificate.website[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = aws_route53_zone.primary.zone_id
}

resource "aws_acm_certificate_validation" "website" {
  count                   = var.enable_managed_dns ? 1 : 0
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.website[0].arn
  validation_record_fqdns = [for record in aws_route53_record.certificate_validation : record.value.fqdn]
}

resource "aws_cloudfront_distribution" "website" {
  count      = var.enable_managed_dns ? 1 : 0
  depends_on = [aws_acm_certificate_validation.website]

  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${local.project_name} marketing site"
  default_root_object = "index.html"

  aliases = [
    var.domain_name,
    local.website_fqdn
  ]

  origin {
    domain_name = aws_s3_bucket.website.bucket_regional_domain_name
    origin_id   = "s3-website"

    origin_access_control_id = aws_cloudfront_origin_access_control.website[0].id
  }

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    compress         = true
    target_origin_id = "s3-website"

    viewer_protocol_policy = "redirect-to-https"

    cache_policy_id            = "658327ea-f89d-4fab-a63d-7e88639e58f6"
    response_headers_policy_id = aws_cloudfront_response_headers_policy.website_security[0].id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate.website[0].arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = merge(local.common_tags, {
    Name = "${local.project_name}-website-cdn"
  })
}

resource "aws_s3_bucket_policy" "website" {
  count  = var.enable_managed_dns ? 1 : 0
  bucket = aws_s3_bucket.website.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action = ["s3:GetObject"]
        Resource = [
          "${aws_s3_bucket.website.arn}/*"
        ]
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.website[0].arn
          }
        }
      }
    ]
  })
}

resource "aws_route53_record" "root" {
  count   = var.enable_managed_dns ? 1 : 0
  zone_id = aws_route53_zone.primary.zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    evaluate_target_health = false
    name                   = aws_cloudfront_distribution.website[0].domain_name
    zone_id                = aws_cloudfront_distribution.website[0].hosted_zone_id
  }
}

resource "aws_route53_record" "root_ipv6" {
  count   = var.enable_managed_dns ? 1 : 0
  zone_id = aws_route53_zone.primary.zone_id
  name    = var.domain_name
  type    = "AAAA"

  alias {
    evaluate_target_health = false
    name                   = aws_cloudfront_distribution.website[0].domain_name
    zone_id                = aws_cloudfront_distribution.website[0].hosted_zone_id
  }
}

resource "aws_route53_record" "website_cname" {
  count   = var.enable_managed_dns && local.website_fqdn != var.domain_name ? 1 : 0
  zone_id = aws_route53_zone.primary.zone_id
  name    = local.website_fqdn
  type    = "CNAME"
  ttl     = 300
  records = [aws_cloudfront_distribution.website[0].domain_name]
}
