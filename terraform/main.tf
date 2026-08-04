terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    http = {
      source  = "hashicorp/http"
      version = "~> 3.4"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# ---------------------------------------------------------------------------
# 1. Read the application secrets (DATABASE_URL + other env vars) from Secrets
#    Manager. They are injected into the Fargate task as environment variables.
# ---------------------------------------------------------------------------
data "aws_secretsmanager_secret_version" "app" {
  secret_id = var.secret_arn
}

locals {
  secret_map = jsondecode(data.aws_secretsmanager_secret_version.app.secret_string)
}

# ---------------------------------------------------------------------------
# 2. A dedicated VPC so the app never depends on your default network.
# ---------------------------------------------------------------------------
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.21.0"

  name                 = "mylife-vpc"
  cidr                 = "10.42.0.0/16"
  azs                  = ["${var.aws_region}a", "${var.aws_region}b"]
  public_subnets       = ["10.42.1.0/24", "10.42.2.0/24"]
  private_subnets      = ["10.42.3.0/24", "10.42.4.0/24"]
  enable_nat_gateway   = true
  single_nat_gateway   = true
  enable_dns_hostnames = true
  enable_dns_support   = true
}

# ---------------------------------------------------------------------------
# 3. Security groups: web only reaches the ALB; the app reaches only the DB.
# ---------------------------------------------------------------------------
resource "aws_security_group" "alb" {
  name        = "mylife-alb-sg"
  description = "Internet-facing load balancer"
  vpc_id      = module.vpc.vpc_id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "ecs" {
  name        = "mylife-ecs-sg"
  description = "Fargate tasks"
  vpc_id      = module.vpc.vpc_id

  ingress {
    from_port       = 8000
    to_port         = 8000
    protocol        = "tcp"
    security_groups   = [aws_security_group.alb.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "rds" {
  name        = "mylife-rds-sg"
  description = "RDS access from Fargate only"
  vpc_id      = module.vpc.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups   = [aws_security_group.ecs.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ---------------------------------------------------------------------------
# 4. SSL certificate (validated via DNS through Route 53).
# ---------------------------------------------------------------------------
resource "aws_acm_certificate" "cert" {
  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# ---------------------------------------------------------------------------
# 5. Application Load Balancer with HTTPS + HTTP→HTTPS redirect.
# ---------------------------------------------------------------------------
resource "aws_lb" "app" {
  name               = "mylife-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = module.vpc.public_subnets
}

resource "aws_lb_target_group" "app" {
  name     = "mylife-tg"
  port     = 8000
  protocol = "HTTP"
  target_type = "ip"
  vpc_id   = module.vpc.vpc_id

  health_check {
    path                = "/health"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200"
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.app.id
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-2016-08"
  certificate_arn   = aws_acm_certificate.cert.arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.app.id
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      protocol    = "HTTPS"
      port        = "443"
      status_code = "HTTP_301"
    }
  }
}

# ---------------------------------------------------------------------------
# 6. ECS: cluster, task definition (image + secret env vars), and the service.
# ---------------------------------------------------------------------------
resource "aws_ecs_cluster" "app" {
  name = "mylife-cluster"
}

resource "aws_cloudwatch_log_group" "ecs" {
  name = "/ecs/mylife"
}

resource "aws_iam_role" "ecs_task_execution" {
  name = "mylife-ecs-exec"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "ecs_task_execution" {
  name = "mylife-ecs-exec-policy"
  role = aws_iam_role.ecs_task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "kms:Decrypt"
        ]
        Resource = var.secret_arn
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_ecs_task_definition" "app" {
  family                   = "mylife-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task_execution.arn
  container_definitions = jsonencode([{
    name      = "mylife"
    image     = var.image_uri
    essential = true
    port      = 8000
    environment = [
      { name = "FRONTEND_DIST", value = "/app/frontend/dist" },
      { name = "PORT", value = "8000" }
    ]
    secrets = [
      { name = "DATABASE_URL",           valueFrom = "${var.secret_arn}:DATABASE_URL::" },
      { name = "APP_SECRET",             valueFrom = "${var.secret_arn}:APP_SECRET::" },
      { name = "CORS_ORIGINS",           valueFrom = "${var.secret_arn}:CORS_ORIGINS::" },
      { name = "FRONTEND_URL",           valueFrom = "${var.secret_arn}:FRONTEND_URL::" },
      { name = "ALLOWED_DOMAIN",         valueFrom = "${var.secret_arn}:ALLOWED_DOMAIN::" },
      { name = "GOOGLE_CLIENT_ID",       valueFrom = "${var.secret_arn}:GOOGLE_CLIENT_ID::" },
      { name = "GOOGLE_CLIENT_SECRET",   valueFrom = "${var.secret_arn}:GOOGLE_CLIENT_SECRET::" },
      { name = "GOOGLE_REDIRECT_URI",    valueFrom = "${var.secret_arn}:GOOGLE_REDIRECT_URI::" },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = "/ecs/mylife"
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "ecs"
      }
    }
    healthCheck = {
      command     = ["CMD-SHELL", "curl -f http://localhost:8000/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 20
    }
  }])
}

resource "aws_ecs_service" "app" {
  name            = "mylife-service"
  cluster         = aws_ecs_cluster.app.id
  task_definition = aws_ecs_task_definition.app.arn
  launch_type     = "FARGATE"
  desired_count   = var.desired_count

  health_check_grace_period_seconds = 30

  load_balancer {
    target_group_arn = aws_lb_target_group.app.id
    container_name   = "mylife"
    container_port   = 8000
  }

  network_configuration {
    subnets            = module.vpc.private_subnets
    security_groups    = [aws_security_group.ecs.id]
    assign_public_ip   = false
  }
}

# ---------------------------------------------------------------------------
# 7. Route 53: validate the cert + point your domain at the ALB.
# ---------------------------------------------------------------------------
resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.cert.domain_validation_options : dvo.resource_record_name => dvo
  }

  zone_id = var.hosted_zone_id
  name    = each.value.resource_record_name
  type    = each.value.resource_record_type
  records = [each.value.resource_record_value]
  ttl     = 60
}

resource "aws_acm_certificate_validation" "cert" {
  certificate_arn         = aws_acm_certificate.cert.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_route53_record" "app_alias" {
  zone_id = var.hosted_zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_lb.app.dns_name
    zone_id                = aws_lb.app.zone_id
    evaluate_target_health = false
  }

  depends_on = [aws_acm_certificate_validation.cert]
}
