resource "google_monitoring_notification_channel" "email" {
  display_name = "${local.project_name}-alerts"
  type         = "email"

  labels = {
    email_address = var.contact_email
  }
}

resource "google_monitoring_alert_policy" "cpu_high" {
  display_name          = "${local.project_name} CPU high"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.email.id]

  conditions {
    display_name = "CPU > 80%"

    condition_threshold {
      filter          = "metric.type=\"compute.googleapis.com/instance/cpu/utilization\" AND resource.type=\"gce_instance\" AND resource.label.\"instance_id\"=\"${google_compute_instance.demo.instance_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8
      duration        = "0s"

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }

      trigger {
        count = 1
      }
    }
  }
}

resource "google_monitoring_alert_policy" "memory_high" {
  display_name          = "${local.project_name} memory high"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.email.id]

  conditions {
    display_name = "Memory > 85%"

    condition_threshold {
      filter          = "metric.type=\"agent.googleapis.com/memory/percent_used\" AND resource.type=\"gce_instance\" AND resource.label.\"instance_id\"=\"${google_compute_instance.demo.instance_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 85
      duration        = "0s"

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }

      trigger {
        count = 1
      }
    }
  }
}

resource "google_monitoring_alert_policy" "disk_high" {
  display_name          = "${local.project_name} disk usage high"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.email.id]

  conditions {
    display_name = "Disk > 85%"

    condition_threshold {
      filter          = "metric.type=\"agent.googleapis.com/disk/percent_used\" AND metric.label.\"state\"=\"used\" AND resource.type=\"gce_instance\" AND resource.label.\"instance_id\"=\"${google_compute_instance.demo.instance_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 85
      duration        = "0s"

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }

      trigger {
        count = 1
      }
    }
  }
}

resource "google_billing_budget" "monthly" {
  count = var.billing_account_id == "" ? 0 : 1

  billing_account = var.billing_account_id
  display_name    = "${local.project_name}-budget"

  amount {
    specified_amount {
      currency_code = "USD"
      units         = floor(var.budget_monthly_limit)
      nanos         = floor((var.budget_monthly_limit - floor(var.budget_monthly_limit)) * 1e9)
    }
  }

  budget_filter {
    projects = ["projects/${local.project_id}"]
  }

  threshold_rules {
    threshold_percent = 0.85
  }

  threshold_rules {
    threshold_percent = 1.0
  }

  all_updates_rule {
    monitoring_notification_channels = [google_monitoring_notification_channel.email.id]
  }
}
