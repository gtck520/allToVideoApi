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
                    HELPER=all-to-video-api-helper
                    docker rm -f "$HELPER" >/dev/null 2>&1 || true

                    # Jenkins 容器内的路径与 Docker 守护进程看到的宿主机路径不一致，
                    # 因此用 docker cp 把工作区文件送进挂载了宿主机目录的临时容器。
                    docker create --name "$HELPER" -v "$HOST_DIR:/dst" alpine sleep infinity >/dev/null

                    # 项目 uuid 不进入构建日志：写入文件后由 helper 容器内部读取
                    set +x
                    printf '%s' "${LIBTV_PROJECT_ID}" > .deploy-project-id
                    set -x

                    tar --exclude='.git' --exclude='.env' --exclude='data' --exclude='.workbuddy' \
                      --exclude='.deploy-project-id' -cf /tmp/all-to-video-api-src.tar .
                    docker cp /tmp/all-to-video-api-src.tar "$HELPER":/src.tar
                    docker cp .deploy-project-id "$HELPER":/tmp/project-id
                    docker start "$HELPER" >/dev/null

                    docker exec "$HELPER" sh -c '
                        set -e
                        mkdir -p /dst/data
                        tar -xf /src.tar -C /dst
                        if [ ! -f /dst/.env ]; then
                            cp /dst/.env.example /dst/.env
                            KEY=$(od -An -N24 -tx1 /dev/urandom | tr -d " \\n")
                            sed -i "s|^GATEWAY_API_KEY=.*|GATEWAY_API_KEY=sk-$KEY|" /dst/.env
                            sed -i "s|^GATEWAY_PORT=.*|GATEWAY_PORT=8787|" /dst/.env
                            PID=$(cat /tmp/project-id)
                            if [ -n "$PID" ]; then
                                sed -i "s|^LIBTV_PROJECT_ID=.*|LIBTV_PROJECT_ID=$PID|" /dst/.env
                            fi
                            if ! grep -q "^GATEWAY_PUBLIC_URL=" /dst/.env; then
                                echo "GATEWAY_PUBLIC_URL=http://127.0.0.1:8787" >> /dst/.env
                            fi
                            echo "Initialized .env (API key hidden)"
                        fi
                        chmod 600 /dst/.env || true
                        ls -la /dst | head -30
                    '

                    rm -f .deploy-project-id /tmp/all-to-video-api-src.tar
                    docker rm -f "$HELPER" >/dev/null 2>&1 || true
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
