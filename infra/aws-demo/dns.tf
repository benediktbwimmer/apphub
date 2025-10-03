resource "aws_route53_zone" "primary" {
  name = var.domain_name

  tags = merge(local.common_tags, {
    Name = "${local.project_name}-zone"
  })
}

resource "aws_route53_record" "demo" {
  zone_id = aws_route53_zone.primary.zone_id
  name    = local.demo_fqdn
  type    = "A"
  ttl     = 300
  records = [aws_eip.demo.public_ip]
}
