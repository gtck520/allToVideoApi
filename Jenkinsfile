pipeline {
    agent any

    options {
        buildDiscarder(logRotator(numToKeepStr: '10'))
        timeout(time: 30, unit: 'MINUTES')
    }

    parameters {
        string(name: 'HOST_PORT', defaultValue: '8787', description: '宿主机映射端口（默认 8787）')
        string(name: 'LIBTV_PROJECT_ID', defaultValue: '', description: 'LibTV 画布 uuid；仅首次初始化 .env 时写入，之后以宿主机 .env 为准')
        booleanParam(name: 'FORCE_REBUILD', defaultValue: false, description: '是否强制无缓存构建镜像')
    }

    environment {
        HOST_DIR  = '/www/all-to-videoApi'
        IMAGE     = 'all-to-video-api:latest'
        CONTAINER = 'all-to-video-api'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Prepare host files') {
            steps {
                sh '''
                    set -e
                    mkdir -p "$HOST_DIR/data"

                    # 同步仓库文件到宿主机目录；保留宿主机已有的 .env 和 data
                    if command -v rsync >/dev/null 2>&1; then
                        rsync -a --delete \
                          --exclude='.git' --exclude='.env' --exclude='data' --exclude='.workbuddy' \
                          ./ "$HOST_DIR/"
                    else
                        tar --exclude='.git' --exclude='.env' --exclude='data' --exclude='.workbuddy' \
                          -cf - . | tar -xf - -C "$HOST_DIR"
                    fi

                    # 首次部署：生成 .env（API key 随机生成且不打印）
                    if [ ! -f "$HOST_DIR/.env" ]; then
                        cp .env.example "$HOST_DIR/.env"
                        KEY=$(openssl rand -hex 24)
                        sed -i "s|^GATEWAY_API_KEY=.*|GATEWAY_API_KEY=sk-$KEY|" "$HOST_DIR/.env"
                        sed -i "s|^GATEWAY_PORT=.*|GATEWAY_PORT=8787|" "$HOST_DIR/.env"
                        if [ -n "${LIBTV_PROJECT_ID}" ]; then
                            sed -i "s|^LIBTV_PROJECT_ID=.*|LIBTV_PROJECT_ID=${LIBTV_PROJECT_ID}|" "$HOST_DIR/.env"
                        fi
                        if ! grep -q '^GATEWAY_PUBLIC_URL=' "$HOST_DIR/.env"; then
                            echo 'GATEWAY_PUBLIC_URL=http://127.0.0.1:8787' >> "$HOST_DIR/.env"
                        fi
                        echo "Initialized $HOST_DIR/.env (generated API key is hidden)"
                    fi
                    chmod 600 "$HOST_DIR/.env" || true

                    echo "Host directory: $HOST_DIR"
                    ls -la "$HOST_DIR" | head -30
                '''
            }
        }

        stage('Build image') {
            steps {
                sh '''
                    set -e
                    if [ "${FORCE_REBUILD}" = "true" ]; then
                        docker build --no-cache --label project=all-to-video-api -t "$IMAGE" .
                    else
                        docker build --label project=all-to-video-api -t "$IMAGE" .
                    fi
                '''
            }
        }

        stage('Deploy') {
            steps {
                sh '''
                    set -e
                    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
                    docker run -d --name "$CONTAINER" --restart unless-stopped \\
                      -p "${HOST_PORT}:8787" \\
                      -v "$HOST_DIR:/app" \\
                      -e GATEWAY_PORT=8787 \\
                      "$IMAGE" node bin/gateway.mjs
                '''
            }
        }

        stage('Verify') {
            steps {
                sh '''
                    set -e
                    sleep 5
                    docker ps --filter "name=^/${CONTAINER}$" --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}'
                    curl -fsS "http://127.0.0.1:${HOST_PORT}/healthz" || {
                        echo "healthz failed; container logs:"
                        docker logs --tail 100 "$CONTAINER"
                        exit 1
                    }
                    curl -fsS "http://127.0.0.1:${HOST_PORT}/docs.md" >/dev/null
                    echo "Deployed: http://127.0.0.1:${HOST_PORT}/docs"
                '''
            }
        }
    }

    post {
        always {
            echo 'all-to-video-api deployment pipeline finished.'
        }
    }
}
