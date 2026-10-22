variable "aws_region" {
  description = "AWS region for Orbit infrastructure"
  type        = string
  default     = "eu-west-1"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "staging"

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.20.0.0/16"
}

variable "db_instance_class" {
  description = "RDS instance class for the authoritative message store"
  type        = string
  default     = "db.t4g.medium"
}

variable "redis_node_type" {
  description = "ElastiCache node type (used for job queue + pub/sub)"
  type        = string
  default     = "cache.t4g.micro"
}

variable "media_bucket_name" {
  description = "Globally-unique S3 bucket name for media object storage"
  type        = string
}

variable "db_master_password" {
  description = "Master password for the RDS instance (pass via TF_VAR_db_master_password)"
  type        = string
  sensitive   = true
}
