# EC2 배포 가이드

`team.tixpass.co.kr` 도메인으로 ARM64 EC2에 haera를 올리는 절차.

## 0. 사전 준비

### AWS

- ECR 저장소 `tixpass` 존재 확인 (없으면 생성, 리전 `ap-northeast-2`)
- IAM 사용자 (GitHub Actions용): `AmazonEC2ContainerRegistryPowerUser` 권한
  - 액세스 키를 GitHub repo Secrets에 등록: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- IAM 역할 (EC2 인스턴스용): `AmazonEC2ContainerRegistryReadOnly`

### EC2

- 인스턴스: **t4g.medium** (ARM64, 2 vCPU / 4GB)
- AMI: Amazon Linux 2023 (arm64)
- EBS: gp3 30GB 이상
- 보안 그룹:
  - 22 inbound — 본인 IP만
  - 80, 443 inbound — 0.0.0.0/0
  - 9000, 9001 inbound — **차단** (Caddy 통해서만 외부 접근 허용 안 함)
- IAM Role: 위에서 만든 ECR ReadOnly role 부착
- 탄력적 IP 할당 (DNS 안정성)

### MongoDB Atlas

- `haera-cluster` (이미 생성됨)
- Network Access → IP Access List에 EC2 탄력적 IP 추가

### DNS

- `team.tixpass.co.kr` A 레코드 → EC2 탄력적 IP

## 1. EC2 부트스트랩

EC2에 SSH 접속 후:

```bash
curl -O https://raw.githubusercontent.com/mannercode/haera/main/scripts/ec2-bootstrap.sh
chmod +x ec2-bootstrap.sh
sudo ./ec2-bootstrap.sh
```

스크립트가 docker, docker compose, git, ECR credential helper 설치하고 `/opt/haera`에 repo clone.

## 2. 환경 변수 설정

```bash
sudo -iu haera
cd /opt/haera
cp .env.prod.example .env
chmod 600 .env
```

`.env` 편집:

```bash
# 실제 값으로 교체:
WEB_IMAGE=<AWS_ACCOUNT_ID>.dkr.ecr.ap-northeast-2.amazonaws.com/tixpass:team
MONGODB_URI=mongodb+srv://writer:...@haera-cluster.04wltu9.mongodb.net/?appName=haera-cluster
SESSION_SECRET=$(openssl rand -hex 32)
HAERA_INTERNAL_TOKEN=$(openssl rand -hex 32)
S3_ACCESS_KEY=$(openssl rand -hex 16)
S3_SECRET_KEY=$(openssl rand -hex 32)
SIGNUP_CODE=0712  # 4자리 임의 코드
```

(`openssl rand -hex 32` 실행 결과를 직접 붙여넣기. `.env` 안에서 명령 치환은 안 됨)

## 3. 첫 배포

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs -f
```

브라우저에서 https://team.tixpass.co.kr 접속.
Caddy가 자동으로 Let's Encrypt 인증서 발급 (첫 요청 시 수십 초 소요).

## 4. 첫 사용자 가입

- `/signup` 접속
- 이름/이메일/비번/인증코드(`SIGNUP_CODE` 값) 입력
- 이 첫 사용자가 자동으로 admin이 됨

## 5. Claude 인증

`.env`의 `CLAUDE_CODE_OAUTH_TOKEN`이 비어있으면, 로그인 후 우측 상단 인증 상태에서 "로그인 시작" → 브라우저 OAuth → 코드 입력 → 토큰 저장됨.

또는 사전에 `claude setup-token`으로 발급한 토큰을 `.env`에 넣어두기.

## 6. 업데이트 배포

main 브랜치에 push하면 GitHub Actions가 ARM64 이미지를 ECR에 푸시.
EC2에서:

```bash
cd /opt/haera
git pull
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

자동화하려면 cron이나 watchtower 등 추가 (선택).

## 7. 백업 / 데이터 보존

- **MongoDB**: Atlas가 자동 백업
- **MinIO 파일**: `/opt/haera/var/minio/` (EBS 안)
  - 정기 백업: `tar czf - var/minio | aws s3 cp - s3://my-backup/haera-$(date +%F).tar.gz`
- **인증/Claude 상태**: `/opt/haera/var/auth/` (재로그인하면 복구 가능하므로 백업 우선순위 낮음)

## 8. 트러블슈팅

```bash
# 컨테이너 상태
docker compose -f docker-compose.prod.yml ps

# 로그
docker compose -f docker-compose.prod.yml logs --tail 100 web
docker compose -f docker-compose.prod.yml logs --tail 100 caddy

# 재시작
docker compose -f docker-compose.prod.yml restart web

# Caddy 인증서 발급 실패 시 (DNS 미연결, 80/443 차단 등 확인)
docker compose -f docker-compose.prod.yml logs caddy | grep -i acme
```

## 보안 체크리스트

- [ ] `.env` 권한 600
- [ ] `SESSION_SECRET`, `HAERA_INTERNAL_TOKEN` 강한 random
- [ ] `S3_SECRET_KEY` 강한 random
- [ ] MongoDB Atlas IP 허용 목록에 EC2 IP만 (0.0.0.0/0 금지)
- [ ] EC2 보안그룹: 22는 본인 IP만, MinIO 포트 차단 확인
- [ ] `SIGNUP_CODE` 본인만 알기
