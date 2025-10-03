data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023*-kernel-6.1-x86_64"]
  }
}

locals {
  env_base = templatefile("${path.module}/templates/env.base.tmpl", {
    demo_fqdn  = local.demo_fqdn
    aws_region = var.aws_region
  })

  caddyfile = templatefile("${path.module}/templates/Caddyfile.tmpl", {
    demo_fqdn     = local.demo_fqdn
    contact_email = var.contact_email
  })

  cloudwatch_agent = templatefile("${path.module}/templates/cloudwatch-agent-config.json.tmpl", {
    instance_id = "INSTANCE_ID_PLACEHOLDER"
  })

  compose_override = file("${path.module}/config/docker-compose.override.yml")

  user_data = templatefile("${path.module}/templates/user_data.sh.tmpl", {
    aws_region       = var.aws_region
    project_name     = local.project_name
    demo_fqdn        = local.demo_fqdn
    apphub_git_repo  = var.apphub_git_repo
    apphub_git_ref   = var.apphub_git_ref
    contact_email    = var.contact_email
    env_base         = local.env_base
    caddyfile        = local.caddyfile
    cloudwatch_agent = local.cloudwatch_agent
    compose_override = local.compose_override
  })
}

resource "aws_instance" "demo" {
  ami                         = data.aws_ami.al2023.id
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.public.id
  vpc_security_group_ids      = [aws_security_group.demo.id]
  iam_instance_profile        = aws_iam_instance_profile.demo.name
  key_name                    = aws_key_pair.demo.key_name
  user_data                   = local.user_data
  monitoring                  = true
  associate_public_ip_address = true

  root_block_device {
    volume_size           = var.root_volume_size_gb
    volume_type           = "gp3"
    throughput            = 125
    encrypted             = true
    delete_on_termination = true
  }

  lifecycle {
    ignore_changes = [user_data, user_data_replace_on_change, user_data_base64]
  }

  tags = merge(local.common_tags, {
    Name = "${local.project_name}-host"
  })

  volume_tags = merge(local.common_tags, {
    Name = "${local.project_name}-root"
  })
}

resource "aws_eip" "demo" {
  domain = "vpc"

  tags = merge(local.common_tags, {
    Name = "${local.project_name}-eip"
  })
}

resource "aws_eip_association" "demo" {
  instance_id   = aws_instance.demo.id
  allocation_id = aws_eip.demo.id
}
