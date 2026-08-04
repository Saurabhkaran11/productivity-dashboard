## Variables for the AWS production deployment.
##
## Copy this file to `terraform/terraform.tfvars` (or set on the CLI) and fill
## in your own values. Run `terraform init && terraform apply` from this folder.

variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "domain_name" {
  description = "Fully-qualified domain name, e.g. mylife.example.com"
  type        = string
}

variable "image_uri" {
  description = "Full ECR image URI, e.g. 123456789012.dkr.ecr.us-east-1.amazonaws.com/mylife-dashboard:latest"
  type        = string
}

variable "secret_arn" {
  description = "ARN of the Secrets Manager secret that holds DATABASE_URL + APP_SECRET etc."
  type        = string
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone ID for domain_name (e.g. ZXXXXXXXXXXXX)"
  type        = string
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.micro"
}

variable "cpu" {
  description = "Fargate CPU units (1 vCPU = 1000)"
  type        = string
  default     = "512"
}

variable "memory" {
  description = "Fargate memory in MB"
  type        = string
  default     = "1024"
}

variable "desired_count" {
  description = "Number of Fargate tasks"
  type        = number
  default     = 1
}
