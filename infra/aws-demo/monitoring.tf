resource "aws_sns_topic" "alerts" {
  name = "${local.project_name}-alerts"

  tags = merge(local.common_tags, {
    Name = "${local.project_name}-alerts"
  })
}

resource "aws_sns_topic_subscription" "alerts_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.contact_email
}

resource "aws_cloudwatch_log_group" "system" {
  name              = "/apphub/demo/stack"
  retention_in_days = 14

  tags = merge(local.common_tags, {
    Name = "${local.project_name}-logs"
  })
}

resource "aws_cloudwatch_metric_alarm" "cpu_high" {
  alarm_name          = "${local.project_name}-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  treat_missing_data  = "notBreaching"

  dimensions = {
    InstanceId = aws_instance.demo.id
  }

  alarm_description = "CPU usage above 80% for 15 minutes"
  alarm_actions     = [aws_sns_topic.alerts.arn]
  ok_actions        = [aws_sns_topic.alerts.arn]

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "disk_high" {
  alarm_name          = "${local.project_name}-disk-usage"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "disk_used_percent"
  namespace           = "CWAgent"
  period              = 300
  statistic           = "Average"
  threshold           = 85
  treat_missing_data  = "notBreaching"

  dimensions = {
    InstanceId = aws_instance.demo.id
    path       = "/"
    device     = "rootfs"
    fstype     = "xfs"
  }

  alarm_description = "Root filesystem usage above 85%"
  alarm_actions     = [aws_sns_topic.alerts.arn]
  ok_actions        = [aws_sns_topic.alerts.arn]

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "memory_high" {
  alarm_name          = "${local.project_name}-memory-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "mem_used_percent"
  namespace           = "CWAgent"
  period              = 300
  statistic           = "Average"
  threshold           = 85
  treat_missing_data  = "notBreaching"

  dimensions = {
    InstanceId = aws_instance.demo.id
  }

  alarm_description = "Memory usage above 85%"
  alarm_actions     = [aws_sns_topic.alerts.arn]
  ok_actions        = [aws_sns_topic.alerts.arn]

  tags = local.common_tags
}

resource "aws_budgets_budget" "monthly" {
  provider          = aws.us_east_1
  name              = "${local.project_name}-budget"
  budget_type       = "COST"
  limit_amount      = var.budget_monthly_limit
  limit_unit        = "USD"
  time_period_start = formatdate("YYYY-MM-01_00:00", timestamp())
  time_unit         = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 85
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.contact_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.contact_email]
  }
}
