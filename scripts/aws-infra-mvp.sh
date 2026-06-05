#!/usr/bin/env bash
# Hermes MVP shared infra (Fargate, public-IP, no ALB/NAT/domain). Idempotent.
# Usage: bash scripts/aws-infra-mvp.sh [region]
set -euo pipefail

REGION="${1:-us-east-1}"
export AWS_DEFAULT_REGION="$REGION"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
TAG="hermes"
CIDR="10.0.0.0/16"

echo "==> Account $ACCOUNT_ID, region $REGION"

# Fetch a resource id by Name tag, empty if absent.
tagged() { aws ec2 describe-"$1" --filters "Name=tag:Name,Values=$2" \
  --query "${3}[0].${4}" --output text 2>/dev/null | grep -v '^None$' || true; }

VPC_ID="$(tagged vpcs "$TAG-vpc" Vpcs VpcId)"
if [ -z "$VPC_ID" ]; then
  VPC_ID="$(aws ec2 create-vpc --cidr-block "$CIDR" \
    --tag-specifications "ResourceType=vpc,Tags=[{Key=Name,Value=$TAG-vpc}]" \
    --query Vpc.VpcId --output text)"
  aws ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-hostnames
  aws ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-support
fi
echo "VPC: $VPC_ID"

IGW_ID="$(aws ec2 describe-internet-gateways \
  --filters "Name=attachment.vpc-id,Values=$VPC_ID" \
  --query 'InternetGateways[0].InternetGatewayId' --output text 2>/dev/null | grep -v '^None$' || true)"
if [ -z "$IGW_ID" ]; then
  IGW_ID="$(aws ec2 create-internet-gateway \
    --tag-specifications "ResourceType=internet-gateway,Tags=[{Key=Name,Value=$TAG-igw}]" \
    --query InternetGateway.InternetGatewayId --output text)"
  aws ec2 attach-internet-gateway --internet-gateway-id "$IGW_ID" --vpc-id "$VPC_ID"
fi
echo "IGW: $IGW_ID"

AZS=($(aws ec2 describe-availability-zones --query 'AvailabilityZones[0:2].ZoneName' --output text))
make_subnet() { # name cidr az
  local id; id="$(tagged subnets "$1" Subnets SubnetId)"
  if [ -z "$id" ]; then
    id="$(aws ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block "$2" --availability-zone "$3" \
      --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$1}]" \
      --query Subnet.SubnetId --output text)"
    aws ec2 modify-subnet-attribute --subnet-id "$id" --map-public-ip-on-launch
  fi
  echo "$id"
}
PUB1="$(make_subnet "$TAG-pub-1" "10.0.0.0/24" "${AZS[0]}")"
PUB2="$(make_subnet "$TAG-pub-2" "10.0.1.0/24" "${AZS[1]}")"
echo "Subnets: $PUB1 $PUB2"

RT_ID="$(tagged route-tables "$TAG-pub-rt" RouteTables RouteTableId)"
if [ -z "$RT_ID" ]; then
  RT_ID="$(aws ec2 create-route-table --vpc-id "$VPC_ID" \
    --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=$TAG-pub-rt}]" \
    --query RouteTable.RouteTableId --output text)"
  aws ec2 create-route --route-table-id "$RT_ID" --destination-cidr-block 0.0.0.0/0 --gateway-id "$IGW_ID" >/dev/null
  aws ec2 associate-route-table --route-table-id "$RT_ID" --subnet-id "$PUB1" >/dev/null
  aws ec2 associate-route-table --route-table-id "$RT_ID" --subnet-id "$PUB2" >/dev/null
fi
echo "RouteTable: $RT_ID"

sg_id() { aws ec2 describe-security-groups --filters "Name=group-name,Values=$1" "Name=vpc-id,Values=$VPC_ID" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null | grep -v '^None$' || true; }
EFS_SG="$(sg_id "$TAG-efs-sg")"
if [ -z "$EFS_SG" ]; then
  EFS_SG="$(aws ec2 create-security-group --group-name "$TAG-efs-sg" \
    --description "Hermes EFS NFS" --vpc-id "$VPC_ID" --query GroupId --output text)"
  # Allow 2049 from the whole VPC so any runtime-created task ENI can mount; tasks are egress-locked.
  aws ec2 authorize-security-group-ingress --group-id "$EFS_SG" \
    --protocol tcp --port 2049 --cidr "$CIDR" >/dev/null
fi
echo "EFS SG: $EFS_SG"

EFS_ID="$(aws efs describe-file-systems --query "FileSystems[?Name=='$TAG-efs'].FileSystemId | [0]" --output text 2>/dev/null | grep -v '^None$' || true)"
if [ -z "$EFS_ID" ]; then
  EFS_ID="$(aws efs create-file-system --performance-mode generalPurpose \
    --throughput-mode elastic --encrypted \
    --tags "Key=Name,Value=$TAG-efs" --query FileSystemId --output text)"
  # `aws efs` has no `wait`; poll until available.
  for _ in $(seq 1 30); do
    state="$(aws efs describe-file-systems --file-system-id "$EFS_ID" \
      --query 'FileSystems[0].LifeCycleState' --output text 2>/dev/null || echo "")"
    [ "$state" = "available" ] && break
    sleep 3
  done
fi
# One mount target per subnet; skip subnets that already have one.
existing_mt_subnets="$(aws efs describe-mount-targets --file-system-id "$EFS_ID" --query 'MountTargets[].SubnetId' --output text 2>/dev/null || true)"
for sub in "$PUB1" "$PUB2"; do
  case " $existing_mt_subnets " in
    *" $sub "*) : ;;
    *) aws efs create-mount-target --file-system-id "$EFS_ID" --subnet-id "$sub" --security-groups "$EFS_SG" >/dev/null ;;
  esac
done
echo "EFS: $EFS_ID"

TRUST=$(cat <<EOF
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}
EOF
)
make_role() { # name
  if ! aws iam get-role --role-name "$1" >/dev/null 2>&1; then
    aws iam create-role --role-name "$1" --assume-role-policy-document "$TRUST" >/dev/null
  fi
  aws iam get-role --role-name "$1" --query Role.Arn --output text
}
EXEC_ARN="$(make_role "$TAG-task-execution")"
aws iam attach-role-policy --role-name "$TAG-task-execution" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy >/dev/null 2>&1 || true
aws iam put-role-policy --role-name "$TAG-task-execution" --policy-name hermes-secrets-read \
  --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"secretsmanager:GetSecretValue\",\"kms:Decrypt\"],\"Resource\":\"arn:aws:secretsmanager:$REGION:$ACCOUNT_ID:secret:hermes/*\"}]}" >/dev/null
# awslogs-create-group in the task def needs CreateLogGroup on the execution role, not just stream/put.
aws iam put-role-policy --role-name "$TAG-task-execution" --policy-name hermes-logs \
  --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"logs:CreateLogGroup\",\"logs:CreateLogStream\",\"logs:PutLogEvents\"],\"Resource\":\"arn:aws:logs:$REGION:$ACCOUNT_ID:log-group:/hermes/*\"}]}" >/dev/null
TASK_ARN="$(make_role "$TAG-task")"
aws iam put-role-policy --role-name "$TAG-task" --policy-name hermes-task-app \
  --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"secretsmanager:GetSecretValue\"],\"Resource\":\"arn:aws:secretsmanager:$REGION:$ACCOUNT_ID:secret:hermes/*\"},{\"Effect\":\"Allow\",\"Action\":[\"logs:CreateLogStream\",\"logs:PutLogEvents\"],\"Resource\":\"arn:aws:logs:$REGION:$ACCOUNT_ID:log-group:/hermes/*:*\"}]}" >/dev/null
echo "Roles: $EXEC_ARN / $TASK_ARN"

CLUSTER="$TAG-cluster"
if [ "$(aws ecs describe-clusters --clusters "$CLUSTER" --query 'clusters[0].status' --output text 2>/dev/null)" != "ACTIVE" ]; then
  aws ecs create-cluster --cluster-name "$CLUSTER" \
    --capacity-providers FARGATE FARGATE_SPOT \
    --default-capacity-provider-strategy capacityProvider=FARGATE,weight=1 >/dev/null
fi
echo "Cluster: $CLUSTER"

aws logs create-log-group --log-group-name /hermes/agents >/dev/null 2>&1 || true
aws logs put-retention-policy --log-group-name /hermes/agents --retention-in-days 30 >/dev/null 2>&1 || true

cat <<EOF

================  Add to apps/web/.env.local  ================
HERMES_RUNTIME=aws
AWS_REGION=$REGION
ECS_CLUSTER=$CLUSTER
SUBNET_IDS=$PUB1,$PUB2
EFS_FILESYSTEM_ID=$EFS_ID
ALB_VPC_ID=$VPC_ID
VPC_CIDR=$CIDR
CERT_DOMAIN=localhost
EXECUTION_ROLE_ARN=$EXEC_ARN
TASK_ROLE_ARN=$TASK_ARN
HERMES_IMAGE=nousresearch/hermes-agent:latest
# (no ALB_LISTENER_ARN — public-IP MVP has no ALB)
=============================================================
EOF
