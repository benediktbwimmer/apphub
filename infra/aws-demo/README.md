# AppHub AWS Demo Stack

Infrastructure-as-code for hosting the AppHub demo stack on a single EC2 instance. Terraform provisions networking, IAM, secrets, the EC2 host with Docker/nginx bootstrapping, CloudWatch monitoring, an SNS alert topic, a monthly cost budget, and (optionally) Route53 + ACM + CloudFront when DNS delegation is ready.

## Prerequisites
- AWS account with Billing activated and an IAM user/role that can manage EC2, VPC, IAM, Route53, ACM, CloudFront, S3, Budgets, SNS, and SSM Parameter Store.
- Locally configured AWS credentials (`aws configure`) with the required permissions.
- Terraform ≥ 1.6.
- GoDaddy access to update the `osiris-apphub.com` nameservers (or transfer the domain to Route53).
- Public SSH key that should receive shell access on the demo instance.

## Manual steps
1. **Create/verify the AWS account** and enable IAM access to Billing if needed.
2. **Configure AWS CLI credentials** locally.
3. **Run an initial Terraform apply targeting the hosted zone** to obtain the Route53 nameservers:
   ```bash
   cd infra/aws-demo
   terraform init
   terraform apply -target=aws_route53_zone.primary
   ```
4. **Update the GoDaddy domain** to use the printed Route53 nameservers. Wait for delegation to propagate (a few minutes up to one hour).
5. **Run the full Terraform apply** once DNS is delegated (or skip this until delegation succeeds):
   ```bash
   terraform apply
   ```
   The apply will:
   - Provision the VPC, subnet, security group, Elastic IP, IAM instance profile, and SSM secrets.
   - Launch the EC2 instance and bootstrap Docker + docker compose plugin, clone the repo, deploy the stack, and configure nginx.
   - Configure CloudWatch metrics/logs, SNS alerts, and the monthly budget control.
   - When `enable_managed_dns = true`, also create ACM certificates, CloudFront distribution, S3 bucket policy, and Route53 records.
6. **Publish the marketing site** after each build. With `enable_managed_dns = false` (default), the static bundle is served locally via nginx; once CloudFront is active the same steps sync to S3 and optionally invalidate the CDN cache:
   ```bash
   npm run build --workspace @apphub/website
   aws s3 sync ../../apps/website/dist s3://$(terraform output -raw website_bucket)
   DIST_ID=$(terraform output -raw website_distribution_id 2>/dev/null || true)
   if [ -n "$DIST_ID" ]; then
     aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths '/*'
   fi
   ```
7. **Rotate tokens/secrets** as needed via Parameter Store (`/apphub/demo/...`) and restart the stack (docker compose or systemd).

## Post-apply validation
After the initial apply (or manual bootstrap):
- SSH to the instance using the configured key: `ssh ec2-user@$(terraform output -raw ec2_public_ip)`.
- Verify containers are healthy: `docker ps` (core API on `:4000`, frontend on `:4173`).
- Confirm nginx is serving the marketing site and proxying `/api`: `curl -I http://<elastic-ip>/` and `curl -s http://<elastic-ip>/api/health`.
- Access in-browser: `http://<elastic-ip>/` for the marketing site, `http://<elastic-ip>:4173/` for the demo UI, and `http://<elastic-ip>:4000/api/health` for the API.

## Configuration
Copy `terraform.tfvars.example` to `terraform.tfvars` and update:
- `ssh_public_key` – Ed25519/RSA key for SSH access.
- `contact_email` – recipient for SNS alarms, nginx ACME email, and budget alerts.
- `apphub_*` secrets – generate strong values before exposing the stack.
- `admin_cidr_blocks` – restrict SSH to trusted networks.
- `budget_monthly_limit` – keep at 110 (≈€100) or adjust per currency.
- `enable_managed_dns` – set to `true` once GoDaddy delegation succeeds so Terraform can bring up ACM + CloudFront; leave `false` to rely on nginx + Elastic IP.

The default plan targets `eu-central-1` with a `t3a.large` instance and a 50 GB gp3 root volume. Adjust `instance_type` or `root_volume_size_gb` if the workload changes.

## Security group exposure
The Terraform security group opens:
- `22/tcp` – SSH (restricted to `admin_cidr_blocks`).
- `80/tcp` – nginx marketing site.
- `443/tcp` – reserved for future TLS.
- `4000/tcp` – AppHub API (needed for the frontend proxy to function).
- `4173/tcp` – AppHub frontend (served directly by the frontend container).

## Outputs
`terraform output` surfaces:
- `demo_endpoint` – host name for the demo stack (used once DNS is delegated).
- `website_endpoint` – marketing site host name (with DNS delegation).
- `ec2_public_ip` – Elastic IP bound to the demo instance (use for SSH and direct access while DNS is pending).
- `route53_nameservers` – values to set at GoDaddy.
- `cloudfront_domain` – CloudFront distribution domain when `enable_managed_dns = true` (otherwise `null`).
- `website_bucket` – S3 bucket that stores the marketing build.
- `website_distribution_id` – CloudFront distribution ID when available.

## Operations
- **SSH:** `ssh ec2-user@$(terraform output -raw ec2_public_ip)`.
- **Stack status:** `docker ps` (containers should be healthy). `docker compose logs -f` for deeper insight.
- **Restart stack:** `cd /opt/apphub/source && docker compose --file docker/demo-stack.compose.yml --file /opt/apphub/docker-compose.override.yml --env-file /opt/apphub/.env up -d --remove-orphans`.
  - The `apphub-demo` systemd unit is generated but disabled by default because BuildKit-based builds require manual repo layout tweaks; use compose commands directly for now.
- **Marketing site updates:** copy new `dist/` contents into `/opt/apphub/website/dist` and reload nginx (`sudo systemctl reload nginx`).
- **API health:** `curl http://<elastic-ip>:4000/health`.
- **Frontend check:** visit `http://<elastic-ip>:4173/` and confirm UI calls succeed (`/api/health`).
- **Logs:** `sudo journalctl -u nginx`, `sudo journalctl -u apphub-demo` (if re-enabled), or CloudWatch Log group `/apphub/demo/stack`.
- **Shutdown:** `terraform destroy` (after removing DNS records if CloudFront is active); remember to stop the EC2 instance if you want to pause spend.

## Troubleshooting
- If `terraform apply` fails on ACM/CloudFront while DNS isn’t delegated, set `enable_managed_dns=false`, re-run, and use the nginx/Elastic IP path until delegation succeeds.
- To re-run the bootstrap script, update `/etc/systemd/system/apphub-demo.service` or invoke docker compose manually; the rendered user-data script lives in `infra/aws-demo/templates/user_data.sh.tmpl`.
- Security group changes applied manually (e.g., opening ports 4000/4173) are captured in Terraform—rerun `terraform plan` before the next apply to pick them up.

## Manual publish cheat sheet
While DNS is pending:
1. Build locally: `npm run build --workspace @apphub/website`.
2. Copy to server: `scp -r apps/website/dist ec2-user@<elastic-ip>:/tmp/apphub-website-dist`.
3. Install on server:
   ```bash
   ssh ec2-user@<elastic-ip> 'sudo rm -rf /opt/apphub/website/dist && sudo mv /tmp/apphub-website-dist /opt/apphub/website/dist && sudo chown -R ec2-user:ec2-user /opt/apphub/website && sudo systemctl reload nginx'
   ```
4. Verify: `curl -I http://<elastic-ip>/` should return `200 OK`.

Once delegation is live, flip `enable_managed_dns` to `true`, run `terraform apply`, and switch browser access to the CloudFront-backed URLs (`https://www.osiris-apphub.com`, `https://demo.osiris-apphub.com`).
