terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }

  # Remote state — configure per environment (e.g. S3 + DynamoDB lock table).
  # backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "orbit-chat"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, 2)
}

# ---------------- Networking ----------------

resource "aws_vpc" "orbit" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "orbit-${var.environment}" }
}

resource "aws_subnet" "private" {
  count                   = 2
  vpc_id                  = aws_vpc.orbit.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index)
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = false

  tags = { Name = "orbit-private-${count.index}" }
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.orbit.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index + 8)
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true

  tags = { Name = "orbit-public-${count.index}" }
}

resource "aws_internet_gateway" "orbit" {
  vpc_id = aws_vpc.orbit.id
  tags   = { Name = "orbit-${var.environment}" }
}

# ---------------- Object storage (media, Spec 10) ----------------

resource "aws_s3_bucket" "media" {
  bucket = var.media_bucket_name
}

# Object storage must never be publicly readable — access is granted only via
# short-lived, scoped URLs (presigned / HMAC) minted by the API.
resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "media" {
  bucket = aws_s3_bucket.media.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    id     = "expire-scoped-uploads"
    status = "Enabled"

    filter {}

    expiration {
      days = 90
    }
  }
}

# ---------------- Managed Postgres (authoritative store) ----------------

resource "aws_db_subnet_group" "orbit" {
  name       = "orbit-${var.environment}"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_security_group" "rds" {
  name   = "orbit-rds-${var.environment}"
  vpc_id = aws_vpc.orbit.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }
}

resource "aws_db_instance" "orbit" {
  identifier              = "orbit-${var.environment}"
  engine                  = "postgres"
  engine_version          = "16"
  instance_class          = var.db_instance_class
  allocated_storage       = 50
  max_allocated_storage   = 200
  db_name                 = "orbit"
  username                = "orbit"
  password                = var.db_master_password
  db_subnet_group_name    = aws_db_subnet_group.orbit.name
  vpc_security_group_ids  = [aws_security_group.rds.id]
  multi_az                = var.environment == "production"
  storage_encrypted       = true
  deletion_protection     = var.environment == "production"
  skip_final_snapshot     = var.environment != "production"
  backup_retention_period = 7
  publicly_accessible     = false
}

# ---------------- Managed Redis (job queue + pub/sub) ----------------

resource "aws_elasticache_subnet_group" "orbit" {
  name       = "orbit-${var.environment}"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_security_group" "redis" {
  name   = "orbit-redis-${var.environment}"
  vpc_id = aws_vpc.orbit.id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }
}

resource "aws_elasticache_cluster" "orbit" {
  cluster_id           = "orbit-${var.environment}"
  engine               = "redis"
  node_type            = var.redis_node_type
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  subnet_group_name    = aws_elasticache_subnet_group.orbit.name
  security_group_ids   = [aws_security_group.redis.id]
  port                 = 6379
}

# ---------------- App tier security group ----------------

resource "aws_security_group" "app" {
  name   = "orbit-app-${var.environment}"
  vpc_id = aws_vpc.orbit.id

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
