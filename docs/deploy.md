# EC2 배포 가이드 (events 서버에 함께 배포)

`team.tixpass.co.kr`을 기존 events 서버(`3.36.196.83`)에 합승하는 방식.
events 프로젝트의 nginx + certbot 인프라를 그대로 사용한다.

## 0. 사전 확인

- ECR `tixpass:team` 이미지 존재 확인:
  ```bash
  aws ecr describe-images --repository-name tixpass --region ap-northeast-2
  ```
- DNS: `team.tixpass.co.kr` A/CNAME → `3.36.196.83` (events와 동일 IP)
- EC2의 IAM role에 ECR pull 권한 — 이미 `ec2-ecr-pull` 부착됨
- events 프로젝트 (`/home/ec2-user/events`)가 동작 중 — nginx 컨테이너가 80/443 점유

## 1. haera repo clone (EC2)

```bash
cd /home/ec2-user
git clone https://github.com/mannercode/haera.git
cd haera
```

## 2. .env 작성

```bash
cp .env.prod.example .env
chmod 600 .env
nano .env
```

다음 값 채우기:

```env
WEB_IMAGE=851563870556.dkr.ecr.ap-northeast-2.amazonaws.com/tixpass:team
MONGODB_URI=mongodb+srv://writer:DJStDnL9IXXd8M13@haera-cluster.04wltu9.mongodb.net/?appName=haera-cluster
MONGODB_DB=haera

CLAUDE_CODE_OAUTH_TOKEN=

S3_ENDPOINT=http://haera-minio:9000
S3_REGION=ap-northeast-2
S3_BUCKET=haera
S3_ACCESS_KEY=$(openssl rand -hex 16)
S3_SECRET_KEY=$(openssl rand -hex 32)
S3_FORCE_PATH_STYLE=true

SESSION_SECRET=$(openssl rand -hex 32)
SIGNUP_CODE=0000  # 4자리 임의

HAERA_INTERNAL_TOKEN=$(openssl rand -hex 32)
```

`openssl rand -hex N` 결과를 직접 복사해 붙여넣기 (`.env`에선 명령 치환 안 됨).

## 3. ECR 로그인 + 이미지 pull

```bash
aws ecr get-login-password --region ap-northeast-2 \
  | docker login --username AWS --password-stdin 851563870556.dkr.ecr.ap-northeast-2.amazonaws.com
docker compose -f docker-compose.prod.yml pull
```

## 4. haera 컨테이너 시작

```bash
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs web | tail -20
```

이 시점에 haera-web/haera-minio가 `events_default` 네트워크에 연결되어 nginx가 컨테이너명으로 호출 가능.

## 5. nginx에 server block 추가 + cert 발급

기존 nginx config 백업:

```bash
cp /home/ec2-user/events/nginx/default.conf /home/ec2-user/events/nginx/default.conf.bak
```

`deploy/nginx-team.conf`의 **HTTP (port 80) 블록만** 먼저 events/nginx/default.conf 끝에 추가:

```bash
cat >> /home/ec2-user/events/nginx/default.conf <<'EOF'

server {
    listen 80;
    server_name team.tixpass.co.kr;
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / {
        return 301 https://$host$request_uri;
    }
}
EOF
```

nginx reload + cert 발급:

```bash
docker exec nginx nginx -t
docker exec nginx nginx -s reload
docker exec certbot certbot certonly --webroot -w /var/www/certbot \
  -d team.tixpass.co.kr --email YOUR_EMAIL@example.com --agree-tos --no-eff-email
```

발급 성공하면 HTTPS 블록 추가:

```bash
cat >> /home/ec2-user/events/nginx/default.conf <<'EOF'

server {
    listen 443 ssl http2;
    server_name team.tixpass.co.kr;

    ssl_certificate /etc/letsencrypt/live/team.tixpass.co.kr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/team.tixpass.co.kr/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    proxy_read_timeout 15m;
    proxy_send_timeout 15m;
    proxy_buffering off;
    client_max_body_size 60m;

    resolver 127.0.0.11 valid=10s;

    location / {
        set $upstream_haera http://haera-web:3000;
        proxy_pass $upstream_haera;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF
docker exec nginx nginx -t
docker exec nginx nginx -s reload
```

## 6. 동작 확인

브라우저: https://team.tixpass.co.kr

`/signup` 로 첫 사용자 가입 (인증 코드는 `.env`의 `SIGNUP_CODE`).
첫 사용자가 자동으로 admin이 되고 기존 데이터가 없으니 빈 워크스페이스에서 시작.

## 7. Claude 인증

로그인 후 우측 상단 "Claude 인증 필요" 노란색 표시 → "로그인 시작" → URL 클릭 → OAuth → 코드 붙여넣기.

## 8. 업데이트 배포

main 브랜치 push → GitHub Actions가 ECR에 새 이미지 푸시.
EC2에서:

```bash
cd /home/ec2-user/haera
git pull
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

## 트러블슈팅

```bash
# 컨테이너 상태
docker compose -f docker-compose.prod.yml ps

# 로그
docker compose -f docker-compose.prod.yml logs --tail 100 web

# nginx 설정 검증
docker exec nginx nginx -t

# nginx 로그
docker logs nginx --tail 50

# certbot 로그
docker logs certbot --tail 30

# 인증서 만료 확인
docker exec certbot certbot certificates
```

## 주의

- `.env` 절대 commit 금지 (.gitignore에 포함됨)
- events nginx config 수정 전 항상 백업 (`.bak`)
- nginx -s reload 전 항상 `nginx -t`로 syntax check
- certbot 발급 시도는 Let's Encrypt 주간 한도 (도메인당 50회/주) 주의
