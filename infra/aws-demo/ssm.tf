resource "aws_ssm_parameter" "session_secret" {
  name        = "/apphub/demo/APPHUB_SESSION_SECRET"
  description = "Session secret for the AppHub demo stack"
  type        = "SecureString"
  overwrite   = true
  value       = var.apphub_session_secret

  tags = merge(local.common_tags, {
    Name = "${local.project_name}-session-secret"
  })
}

resource "aws_ssm_parameter" "demo_admin" {
  name        = "/apphub/demo/APPHUB_DEMO_ADMIN_TOKEN"
  description = "Admin token for the AppHub demo stack"
  type        = "SecureString"
  overwrite   = true
  value       = var.apphub_demo_admin_token

  tags = merge(local.common_tags, {
    Name = "${local.project_name}-admin-token"
  })
}

resource "aws_ssm_parameter" "demo_service" {
  name        = "/apphub/demo/APPHUB_DEMO_SERVICE_TOKEN"
  description = "Service token for the AppHub demo stack"
  type        = "SecureString"
  overwrite   = true
  value       = var.apphub_demo_service_token

  tags = merge(local.common_tags, {
    Name = "${local.project_name}-service-token"
  })
}

resource "aws_ssm_parameter" "demo_viewer" {
  name        = "/apphub/demo/APPHUB_DEMO_VIEWER_TOKEN"
  description = "Viewer token for the AppHub demo stack"
  type        = "SecureString"
  overwrite   = true
  value       = var.apphub_demo_viewer_token

  tags = merge(local.common_tags, {
    Name = "${local.project_name}-viewer-token"
  })
}
