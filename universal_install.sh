#!/bin/bash
##########################################################################################
# CONNEXA ADMIN PANEL - УНИВЕРСАЛЬНЫЙ УСТАНОВОЧНЫЙ СКРИПТ
# Автоматическая установка с GitHub с поэтапными тестами и проверками
# Версия: 3.2 - АГРЕССИВНАЯ ОЧИСТКА LOCK + BACKEND ONLY
# Репозиторий: https://github.com/mrolivershea-cyber/10-16-2025-final-fix-auto
##########################################################################################

set -e  # Exit on any error

# КРИТИЧЕСКИ ВАЖНО: Отключить все интерактивные диалоги
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
export NEEDRESTART_SUSPEND=1

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Глобальные переменные
INSTALL_DIR="/app"
REPO_URL="https://github.com/mrolivershea-cyber/10-16-2025-final-fix-auto.git"
BRANCH="main"
ERRORS_FOUND=0
WARNINGS_FOUND=0

##########################################################################################
# Функции для вывода
##########################################################################################

print_header() {
    echo ""
    echo "════════════════════════════════════════════════════════════════════════════════"
    echo -e "${CYAN}$1${NC}"
    echo "════════════════════════════════════════════════════════════════════════════════"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
    ERRORS_FOUND=$((ERRORS_FOUND + 1))
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
    WARNINGS_FOUND=$((WARNINGS_FOUND + 1))
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_test() {
    echo -e "${CYAN}🧪 $1${NC}"
}

##########################################################################################
# Функция теста: проверка после каждого шага
##########################################################################################

test_step() {
    local step_name=$1
    local test_command=$2
    local expected_result=$3
    
    print_test "Testing: $step_name"
    
    if eval "$test_command"; then
        print_success "$step_name - PASSED"
        return 0
    else
        print_error "$step_name - FAILED"
        if [ "$expected_result" == "critical" ]; then
            echo ""
            echo -e "${RED}CRITICAL ERROR: Cannot continue installation!${NC}"
            exit 1
        fi
        return 1
    fi
}

##########################################################################################
# BANNER
##########################################################################################

clear
echo "╔════════════════════════════════════════════════════════════════════════════════╗"
echo "║                                                                                ║"
echo "║               CONNEXA ADMIN PANEL - УНИВЕРСАЛЬНАЯ УСТАНОВКА v3.2              ║"
echo "║                                                                                ║"
echo "║            🚀 АГРЕССИВНАЯ ОЧИСТКА LOCK + BACKEND ONLY + AUTO IP               ║"
echo "║                                                                                ║"
echo "╚════════════════════════════════════════════════════════════════════════════════╝"
echo ""
sleep 2

##########################################################################################
# ПРОВЕРКА ROOT
##########################################################################################

print_header "ПРОВЕРКА ПРАВ"

if [ "$EUID" -ne 0 ]; then
    print_error "Скрипт должен быть запущен с правами root"
    echo ""
    echo "Используйте: sudo bash universal_install.sh"
    exit 1
fi

print_success "Запущено с правами root"

##########################################################################################
# ОЧИСТКА ЗАБЛОКИРОВАННЫХ ПРОЦЕССОВ APT/DPKG (АГРЕССИВНАЯ)
##########################################################################################

print_header "ПОДГОТОВКА СИСТЕМЫ"

print_info "Ожидание завершения других процессов установки..."

# Функция для агрессивного убийства процесса
kill_process_hard() {
    local process_name=$1
    local max_attempts=5
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if pgrep -x "$process_name" > /dev/null; then
            print_info "Попытка $attempt: Убиваем процесс $process_name..."
            pkill -9 "$process_name" 2>/dev/null || true
            sleep 2
            
            if ! pgrep -x "$process_name" > /dev/null; then
                print_success "Процесс $process_name остановлен"
                return 0
            fi
        else
            return 0
        fi
        attempt=$((attempt + 1))
    done
    
    print_warning "Не удалось остановить $process_name после $max_attempts попыток"
    return 1
}

# Убить все процессы которые могут блокировать dpkg
print_info "Остановка конфликтующих процессов..."
kill_process_hard "apt-get"
kill_process_hard "apt"
kill_process_hard "dpkg"
kill_process_hard "unattended-upgr"
kill_process_hard "packagekitd"

# Подождать
sleep 3

# Удалить все lock файлы
print_info "Удаление всех lock файлов..."
rm -f /var/lib/dpkg/lock-frontend 2>/dev/null || true
rm -f /var/lib/dpkg/lock 2>/dev/null || true
rm -f /var/lib/apt/lists/lock 2>/dev/null || true
rm -f /var/cache/apt/archives/lock 2>/dev/null || true
rm -f /var/lib/dpkg/lock-backend 2>/dev/null || true

# Ещё одна проверка и ожидание
sleep 3

# Исправить dpkg И ДОЖДАТЬСЯ ЗАВЕРШЕНИЯ
print_info "Восстановление состояния dpkg (может занять 1-2 минуты)..."
DEBIAN_FRONTEND=noninteractive dpkg --configure -a 2>&1 | tee /tmp/dpkg_configure.log | tail -5

# Ждём завершения dpkg
print_info "Ожидание полного завершения dpkg..."
sleep 5

# Проверка что dpkg завершился
if pgrep -x "dpkg" > /dev/null; then
    print_warning "dpkg всё ещё работает, ждём ещё 10 секунд..."
    sleep 10
fi

# Финальная очистка lock файлов после dpkg
print_info "Финальная очистка lock файлов..."
rm -f /var/lib/dpkg/lock-frontend 2>/dev/null || true
rm -f /var/lib/dpkg/lock 2>/dev/null || true

print_success "Система готова к установке"

##########################################################################################
# ШАГ 1: УСТАНОВКА СИСТЕМНЫХ ПАКЕТОВ
##########################################################################################

print_header "ШАГ 1/12: УСТАНОВКА СИСТЕМНЫХ ПАКЕТОВ"

print_info "Проверка менеджера пакетов..."
if ! command -v apt-get &> /dev/null; then
    print_error "apt-get не найден. Этот скрипт работает только на Debian/Ubuntu"
    exit 1
fi

# Отключить интерактивные перезагрузки служб
print_info "Отключение интерактивных диалогов..."
if [ -f /etc/needrestart/needrestart.conf ]; then
    sed -i "s/#\$nrconf{restart} = 'i';/\$nrconf{restart} = 'a';/" /etc/needrestart/needrestart.conf 2>/dev/null || true
fi

# Отключить диалоги kernel upgrade
if [ -f /etc/needrestart/conf.d/50-local.conf ]; then
    echo "\$nrconf{kernelhints} = 0;" > /etc/needrestart/conf.d/50-local.conf
else
    mkdir -p /etc/needrestart/conf.d/
    echo "\$nrconf{kernelhints} = 0;" > /etc/needrestart/conf.d/50-local.conf
fi

print_info "Обновление списка пакетов..."
apt-get update -qq 2>&1 | grep -v "debconf:" || true

print_info "Установка базовых пакетов..."
apt-get install -y -qq \
    -o Dpkg::Options::="--force-confdef" \
    -o Dpkg::Options::="--force-confold" \
    python3 \
    python3-pip \
    python3-venv \
    ppp \
    pptp-linux \
    sqlite3 \
    curl \
    wget \
    git \
    supervisor \
    net-tools \
    iputils-ping \
    iptables 2>&1 | grep -v "debconf:" || true

# ТЕСТ 1: Проверка установленных пакетов
test_step "Python3 установлен" "command -v python3 &> /dev/null" "critical"
test_step "pip установлен" "command -v pip3 &> /dev/null" "critical"
test_step "pppd установлен" "command -v pppd &> /dev/null" "critical"
test_step "git установлен" "command -v git &> /dev/null" "critical"
test_step "supervisor установлен" "command -v supervisorctl &> /dev/null" "critical"

print_success "Системные пакеты установлены"

##########################################################################################
# ШАГ 2: УСТАНОВКА NODE.JS (БЕЗ YARN)
##########################################################################################

print_header "ШАГ 2/12: УСТАНОВКА NODE.JS"

if ! command -v node &> /dev/null || [ "$(node --version | cut -d'.' -f1 | tr -d 'v')" -lt 18 ]; then
    print_info "Установка Node.js 18.x..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - > /dev/null 2>&1
    apt-get install -y -qq \
        -o Dpkg::Options::="--force-confdef" \
        -o Dpkg::Options::="--force-confold" \
        nodejs 2>&1 | grep -v "debconf:" || true
    print_success "Node.js установлен: $(node --version)"
else
    print_info "Node.js уже установлен: $(node --version)"
fi

# Настройка npm для работы с проблемами сети
print_info "Настройка npm для стабильной работы..."
npm config set fetch-retry-mintimeout 20000 2>/dev/null || true
npm config set fetch-retry-maxtimeout 120000 2>/dev/null || true
npm config set fetch-timeout 300000 2>/dev/null || true
npm config set registry https://registry.npmjs.org/ 2>/dev/null || true

# ТЕСТ 2: Проверка Node.js
test_step "Node.js версия >= 18" "[ \$(node --version | cut -d'.' -f1 | tr -d 'v') -ge 18 ]" "critical"
test_step "npm доступен" "command -v npm &> /dev/null" "critical"

##########################################################################################
# ШАГ 3: КЛОНИРОВАНИЕ РЕПОЗИТОРИЯ
##########################################################################################

print_header "ШАГ 3/12: КЛОНИРОВАНИЕ РЕПОЗИТОРИЯ ИЗ GITHUB"

print_info "Репозиторий: $REPO_URL"
print_info "Ветка: $BRANCH"
print_info "Директория: $INSTALL_DIR"

if [ -d "$INSTALL_DIR/.git" ]; then
    print_warning "Директория $INSTALL_DIR уже содержит Git репозиторий"
    print_info "Обновление существующего репозитория..."
    cd "$INSTALL_DIR"
    git fetch origin
    git reset --hard origin/$BRANCH
    print_success "Репозиторий обновлён"
else
    if [ -d "$INSTALL_DIR" ] && [ "$(ls -A $INSTALL_DIR)" ]; then
        print_warning "Директория $INSTALL_DIR не пустая. Создаю бэкап..."
        mv "$INSTALL_DIR" "${INSTALL_DIR}_backup_$(date +%Y%m%d_%H%M%S)"
    fi
    
    print_info "Клонирование репозитория..."
    git clone -b $BRANCH $REPO_URL $INSTALL_DIR
    print_success "Репозиторий склонирован"
fi

cd "$INSTALL_DIR"

# ТЕСТ 3: Проверка структуры репозитория
test_step "backend директория существует" "[ -d $INSTALL_DIR/backend ]" "critical"
test_step "frontend директория существует" "[ -d $INSTALL_DIR/frontend ]" "critical"
test_step "requirements.txt существует" "[ -f $INSTALL_DIR/backend/requirements.txt ]" "critical"
test_step "package.json существует" "[ -f $INSTALL_DIR/frontend/package.json ]" "critical"

##########################################################################################
# ШАГ 4: СОЗДАНИЕ /dev/ppp
##########################################################################################

print_header "ШАГ 4/12: НАСТРОЙКА PPTP УСТРОЙСТВА"

if [ -e /dev/ppp ]; then
    print_info "/dev/ppp уже существует"
else
    print_info "Создание /dev/ppp..."
    mknod /dev/ppp c 108 0
    chmod 600 /dev/ppp
    print_success "/dev/ppp создан"
fi

print_info "Права на /dev/ppp:"
ls -la /dev/ppp

# ТЕСТ 4: Проверка /dev/ppp
test_step "/dev/ppp существует" "[ -e /dev/ppp ]" "critical"
test_step "/dev/ppp доступен для записи" "[ -w /dev/ppp ]" "warning"

##########################################################################################
# ШАГ 5: НАСТРОЙКА PPTP КОНФИГУРАЦИИ
##########################################################################################

print_header "ШАГ 5/12: НАСТРОЙКА PPTP КОНФИГУРАЦИИ"

mkdir -p /etc/ppp/peers

cat > /etc/ppp/options.pptp << 'EOF'
lock
noauth
nobsdcomp
nodeflate
EOF

print_success "PPTP конфигурация создана"

# ТЕСТ 5: Проверка PPTP конфигурации
test_step "PPTP config создан" "[ -f /etc/ppp/options.pptp ]" "warning"

##########################################################################################
# ШАГ 6: УСТАНОВКА PYTHON ЗАВИСИМОСТЕЙ
##########################################################################################

print_header "ШАГ 6/12: УСТАНОВКА PYTHON ЗАВИСИМОСТЕЙ"

cd "$INSTALL_DIR/backend"

if [ ! -d "venv" ]; then
    print_info "Создание виртуального окружения Python..."
    python3 -m venv venv
    print_success "Виртуальное окружение создано"
else
    print_info "Виртуальное окружение уже существует"
fi

source venv/bin/activate

print_info "Обновление pip..."
pip install --upgrade pip --quiet 2>&1 | grep -v "WARNING" || true

print_info "Установка Python пакетов из requirements.txt..."
pip install -r requirements.txt --quiet 2>&1 | grep -v "WARNING" || true

print_success "Python зависимости установлены"

# ТЕСТ 6: Проверка Python зависимостей
test_step "Virtual environment активирован" "[ -n \"\$VIRTUAL_ENV\" ]" "critical"
test_step "FastAPI установлен" "python -c 'import fastapi' 2>/dev/null" "critical"
test_step "SQLAlchemy установлен" "python -c 'import sqlalchemy' 2>/dev/null" "critical"
test_step "uvicorn установлен" "command -v uvicorn &> /dev/null" "critical"

deactivate

##########################################################################################
# ШАГ 7: УСТАНОВКА FRONTEND ЗАВИСИМОСТЕЙ (ОПЦИОНАЛЬНЫЙ ШАГ)
##########################################################################################

print_header "ШАГ 7/12: FRONTEND ЗАВИСИМОСТИ (ОПЦИОНАЛЬНО)"

cd "$INSTALL_DIR/frontend"

print_warning "Frontend установка ПРОПУЩЕНА (требует стабильный npm registry)"
print_info "Backend API работает полностью без frontend"
print_info "Frontend можно установить позже вручную если нужен UI"
print_info ""
print_info "Для установки frontend вручную:"
print_info "  cd /app/frontend"
print_info "  npm install --legacy-peer-deps --force"
print_info "  sudo supervisorctl restart frontend"
print_info ""
print_success "Пропускаем frontend, продолжаем backend установку..."

# ТЕСТ 7: Пропускаем (frontend не критичен)
print_info "⏩ Frontend тесты пропущены (не требуется для backend)"

##########################################################################################
# ШАГ 8: ПРОВЕРКА И АВТООБНОВЛЕНИЕ .ENV ФАЙЛОВ
##########################################################################################

print_header "ШАГ 8/12: НАСТРОЙКА ПЕРЕМЕННЫХ ОКРУЖЕНИЯ"

# Определить IP сервера
SERVER_IP=$(hostname -I | awk '{print $1}')
print_info "IP сервера: $SERVER_IP"

# Backend .env
if [ -f "$INSTALL_DIR/backend/.env" ]; then
    print_success "Backend .env найден"
    
    if grep -q "ADMIN_SERVER_IP" "$INSTALL_DIR/backend/.env"; then
        ADMIN_IP=$(grep ADMIN_SERVER_IP "$INSTALL_DIR/backend/.env" | cut -d'=' -f2 | tr -d '"' | tr -d "'")
        print_info "ADMIN_SERVER_IP = $ADMIN_IP"
        
        # Автоматически обновить на реальный IP если это emergentagent.com или localhost
        if [[ "$ADMIN_IP" == *"emergentagent.com"* ]] || [[ "$ADMIN_IP" == "localhost"* ]]; then
            print_warning "ADMIN_SERVER_IP указывает на тестовый домен, обновляем..."
            sed -i "s|ADMIN_SERVER_IP=.*|ADMIN_SERVER_IP=$SERVER_IP|g" "$INSTALL_DIR/backend/.env"
            print_success "ADMIN_SERVER_IP обновлён на $SERVER_IP"
        fi
    else
        print_warning "ADMIN_SERVER_IP не найден, добавляем..."
        echo "ADMIN_SERVER_IP=$SERVER_IP" >> "$INSTALL_DIR/backend/.env"
        print_success "ADMIN_SERVER_IP добавлен"
    fi
else
    print_warning "Backend .env не найден, создаём..."
    cat > "$INSTALL_DIR/backend/.env" << EOF
ADMIN_SERVER_IP=$SERVER_IP
DATABASE_URL=sqlite:///./connexa.db
SECRET_KEY=$(openssl rand -hex 32)
EOF
    print_success "Backend .env создан"
fi

# Frontend .env - КРИТИЧЕСКИ ВАЖНО
if [ -f "$INSTALL_DIR/frontend/.env" ]; then
    print_success "Frontend .env найден"
    
    if grep -q "REACT_APP_BACKEND_URL" "$INSTALL_DIR/frontend/.env"; then
        BACKEND_URL=$(grep REACT_APP_BACKEND_URL "$INSTALL_DIR/frontend/.env" | cut -d'=' -f2)
        print_info "Текущий REACT_APP_BACKEND_URL = $BACKEND_URL"
        
        # АВТОМАТИЧЕСКИ ОБНОВИТЬ НА ПРАВИЛЬНЫЙ URL
        if [[ "$BACKEND_URL" != "http://$SERVER_IP:8001" ]]; then
            print_warning "REACT_APP_BACKEND_URL неправильный, обновляем..."
            sed -i "s|REACT_APP_BACKEND_URL=.*|REACT_APP_BACKEND_URL=http://$SERVER_IP:8001|g" "$INSTALL_DIR/frontend/.env"
            print_success "REACT_APP_BACKEND_URL обновлён на http://$SERVER_IP:8001"
        else
            print_success "REACT_APP_BACKEND_URL уже правильный"
        fi
    else
        print_warning "REACT_APP_BACKEND_URL не найден, добавляем..."
        echo "REACT_APP_BACKEND_URL=http://$SERVER_IP:8001" >> "$INSTALL_DIR/frontend/.env"
        print_success "REACT_APP_BACKEND_URL добавлен"
    fi
else
    print_warning "Frontend .env не найден, создаём..."
    cat > "$INSTALL_DIR/frontend/.env" << EOF
REACT_APP_BACKEND_URL=http://$SERVER_IP:8001
EOF
    print_success "Frontend .env создан"
fi

print_success "Переменные окружения настроены для IP: $SERVER_IP"

# ТЕСТ 8: Проверка .env файлов
test_step "Backend .env существует" "[ -f $INSTALL_DIR/backend/.env ]" "critical"
test_step "Frontend .env существует" "[ -f $INSTALL_DIR/frontend/.env ]" "critical"
test_step "REACT_APP_BACKEND_URL правильный" "grep -q \"REACT_APP_BACKEND_URL=http://$SERVER_IP:8001\" $INSTALL_DIR/frontend/.env" "critical"

##########################################################################################
# ШАГ 9: ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ
##########################################################################################

print_header "ШАГ 9/12: ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ"

cd "$INSTALL_DIR/backend"
source venv/bin/activate

if [ ! -f "connexa.db" ]; then
    print_info "Создание SQLite базы данных..."
    
    python3 << 'PYTHON_SCRIPT'
import sys
sys.path.insert(0, '/app/backend')

try:
    from database import Base, engine, SessionLocal, User, hash_password
    
    # Создать все таблицы
    Base.metadata.create_all(bind=engine)
    
    # Создать админа по умолчанию
    db = SessionLocal()
    
    # Проверить есть ли уже admin
    existing_admin = db.query(User).filter(User.username == "admin").first()
    
    if not existing_admin:
        admin = User(
            username="admin",
            password=hash_password("admin")
        )
        db.add(admin)
        db.commit()
        print("✅ Admin пользователь создан (admin/admin)")
    else:
        print("ℹ️  Admin пользователь уже существует")
    
    db.close()
    print("✅ База данных инициализирована")
    
except Exception as e:
    print(f"❌ Ошибка инициализации БД: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
PYTHON_SCRIPT

    if [ $? -eq 0 ]; then
        print_success "База данных создана"
    else
        print_error "Ошибка создания базы данных"
        print_warning "Продолжаем установку без БД - создайте вручную"
    fi
else
    print_info "База данных connexa.db уже существует"
    
    # Проверка наличия админа
    print_info "Проверка пользователя admin..."
    python3 << 'PYTHON_SCRIPT'
import sys
sys.path.insert(0, '/app/backend')

try:
    from database import SessionLocal, User, hash_password
    
    db = SessionLocal()
    admin = db.query(User).filter(User.username == "admin").first()
    
    if admin:
        print("✅ Пользователь admin существует")
    else:
        print("⚠️  Пользователь admin не найден, создаём...")
        admin = User(username="admin", password=hash_password("admin"))
        db.add(admin)
        db.commit()
        print("✅ Пользователь admin создан")
    
    db.close()
except Exception as e:
    print(f"⚠️  Ошибка проверки admin: {e}")
PYTHON_SCRIPT
fi

deactivate

# ТЕСТ 9: Проверка базы данных
test_step "База данных создана" "[ -f $INSTALL_DIR/backend/connexa.db ]" "critical"
test_step "База данных доступна для записи" "[ -w $INSTALL_DIR/backend/connexa.db ]" "critical"
test_step "Таблица users существует" "sqlite3 $INSTALL_DIR/backend/connexa.db 'SELECT name FROM sqlite_master WHERE type=\"table\" AND name=\"users\";' | grep -q users" "critical"

##########################################################################################
# ШАГ 10: НАСТРОЙКА SUPERVISOR
##########################################################################################

print_header "ШАГ 10/12: НАСТРОЙКА SUPERVISOR"

# Backend config
print_info "Создание конфигурации backend..."
cat > /etc/supervisor/conf.d/connexa-backend.conf << EOF
[program:backend]
command=$INSTALL_DIR/backend/venv/bin/uvicorn server:app --host 0.0.0.0 --port 8001
directory=$INSTALL_DIR/backend
autostart=true
autorestart=true
stderr_logfile=/var/log/supervisor/backend.err.log
stdout_logfile=/var/log/supervisor/backend.out.log
user=root
environment=PATH="$INSTALL_DIR/backend/venv/bin:/usr/local/bin:/usr/bin:/bin"
EOF

print_success "Backend конфигурация создана"

print_info "Frontend supervisor конфиг ПРОПУЩЕН (устанавливается вручную при необходимости)"

# Reload supervisor
print_info "Перезагрузка Supervisor..."
supervisorctl reread
supervisorctl update

print_success "Supervisor настроен"

# ТЕСТ 10: Проверка Supervisor конфигурации
test_step "Backend supervisor config создан" "[ -f /etc/supervisor/conf.d/connexa-backend.conf ]" "critical"

##########################################################################################
# ШАГ 11: ЗАПУСК СЕРВИСОВ
##########################################################################################

print_header "ШАГ 11/12: ЗАПУСК СЕРВИСОВ"

print_info "Запуск backend..."
supervisorctl start backend
sleep 5

print_success "Backend запущен"

print_info "Ожидание готовности backend (30 секунд)..."
for i in {30..1}; do
    echo -ne "\r⏳ Осталось: $i секунд   "
    sleep 1
done
echo ""

print_info "Статус сервисов:"
supervisorctl status

# ТЕСТ 11: Проверка запущенных сервисов
test_step "Backend процесс запущен" "supervisorctl status backend | grep -q RUNNING" "critical"
test_step "Backend слушает порт 8001" "netstat -tuln | grep -q ':8001' || sleep 5 && netstat -tuln | grep -q ':8001'" "critical"

##########################################################################################
# ШАГ 12: ФИНАЛЬНЫЕ ТЕСТЫ API
##########################################################################################

print_header "ШАГ 12/12: ФИНАЛЬНОЕ ТЕСТИРОВАНИЕ API"

print_info "Ожидание готовности backend API..."
RETRY_COUNT=0
MAX_RETRIES=10

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -s -f http://localhost:8001/api/stats > /dev/null 2>&1; then
        print_success "Backend API отвечает"
        break
    else
        RETRY_COUNT=$((RETRY_COUNT + 1))
        echo -ne "\r⏳ Попытка $RETRY_COUNT/$MAX_RETRIES..."
        sleep 3
    fi
done
echo ""

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    print_error "Backend API не отвечает после $MAX_RETRIES попыток"
    print_info "Проверьте логи: tail -f /var/log/supervisor/backend.err.log"
else
    # ТЕСТ 12: API endpoints
    test_step "GET /api/stats работает" "curl -s -f http://localhost:8001/api/stats > /dev/null" "critical"
    
    # Попробовать логин
    print_test "Тестирование логина admin/admin..."
    LOGIN_RESULT=$(curl -s -X POST http://localhost:8001/api/auth/login \
        -H "Content-Type: application/json" \
        -d '{"username":"admin","password":"admin"}')
    
    if echo "$LOGIN_RESULT" | grep -q "access_token"; then
        print_success "Логин admin/admin работает ✅"
        TOKEN=$(echo "$LOGIN_RESULT" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
        print_info "Токен получен: ${TOKEN:0:50}..."
    else
        print_warning "Не удалось войти с admin/admin"
        print_info "Результат: $LOGIN_RESULT"
    fi
fi

##########################################################################################
# ИТОГОВЫЙ ОТЧЁТ
##########################################################################################

print_header "УСТАНОВКА ЗАВЕРШЕНА"

echo ""
echo "╔════════════════════════════════════════════════════════════════════════════════╗"
echo "║                           СТАТИСТИКА УСТАНОВКИ                                  ║"
echo "╚════════════════════════════════════════════════════════════════════════════════╝"
echo ""

if [ $ERRORS_FOUND -eq 0 ] && [ $WARNINGS_FOUND -eq 0 ]; then
    print_success "ВСЕ ТЕСТЫ ПРОЙДЕНЫ! Ошибок: 0, Предупреждений: 0"
    echo ""
    echo -e "${GREEN}🎉 Установка успешно завершена!${NC}"
elif [ $ERRORS_FOUND -eq 0 ]; then
    print_warning "Установка завершена с предупреждениями: $WARNINGS_FOUND"
    echo ""
    echo -e "${YELLOW}⚠️  Система установлена, но есть предупреждения${NC}"
else
    print_error "Установка завершена с ошибками: $ERRORS_FOUND, Предупреждений: $WARNINGS_FOUND"
    echo ""
    echo -e "${RED}❌ Некоторые компоненты могут работать неправильно${NC}"
fi

echo ""
echo "════════════════════════════════════════════════════════════════════════════════"
echo -e "${CYAN}📋 BACKEND API ГОТОВ К ИСПОЛЬЗОВАНИЮ${NC}"
echo "════════════════════════════════════════════════════════════════════════════════"
echo ""
echo "🔧 Backend API:"
echo "   http://$(hostname -I | awk '{print $1}'):8001"
echo "   http://$(hostname -I | awk '{print $1}'):8001/docs (Swagger UI)"
echo ""
echo "🔐 Логин:"
echo "   Username: admin"
echo "   Password: admin"
echo ""
echo "════════════════════════════════════════════════════════════════════════════════"
echo -e "${CYAN}📱 ИСПОЛЬЗОВАНИЕ API${NC}"
echo "════════════════════════════════════════════════════════════════════════════════"
echo ""
echo "Пример логина через curl:"
echo "  curl -X POST http://$(hostname -I | awk '{print $1}'):8001/api/auth/login \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"username\":\"admin\",\"password\":\"admin\"}'"
echo ""
echo "Получить статистику:"
echo "  curl http://$(hostname -I | awk '{print $1}'):8001/api/stats \\"
echo "    -H 'Authorization: Bearer ВАШ_ТОКЕН'"
echo ""
echo "════════════════════════════════════════════════════════════════════════════════"
echo -e "${CYAN}🎯 УСТАНОВКА FRONTEND (ОПЦИОНАЛЬНО)${NC}"
echo "════════════════════════════════════════════════════════════════════════════════"
echo ""
echo "Frontend (React UI) можно установить отдельно:"
echo ""
echo "  cd /app/frontend"
echo "  npm install --legacy-peer-deps --force"
echo "  npm install ajv@^8.0.0 --legacy-peer-deps"
echo ""
echo "  # Создать supervisor конфиг:"
echo "  sudo bash -c 'cat > /etc/supervisor/conf.d/connexa-frontend.conf << EOF"
echo "[program:frontend]"
echo "command=/usr/bin/npm start"
echo "directory=/app/frontend"
echo "autostart=true"
echo "autorestart=true"
echo "stderr_logfile=/var/log/supervisor/frontend.err.log"
echo "stdout_logfile=/var/log/supervisor/frontend.out.log"
echo "environment=PATH=\"/usr/local/bin:/usr/bin:/bin\",HOST=\"0.0.0.0\",PORT=\"3000\""
echo "user=root"
echo "EOF'"
echo ""
echo "  # Запустить:"
echo "  sudo supervisorctl reread"
echo "  sudo supervisorctl update"
echo "  sudo supervisorctl start frontend"
echo ""
echo "Frontend будет доступен на: http://$(hostname -I | awk '{print $1}'):3000"
echo ""
echo "════════════════════════════════════════════════════════════════════════════════"
echo -e "${CYAN}📝 ПОЛЕЗНЫЕ КОМАНДЫ${NC}"
echo "════════════════════════════════════════════════════════════════════════════════"
echo ""
echo "Проверить статус:"
echo "  sudo supervisorctl status"
echo ""
echo "Перезапустить backend:"
echo "  sudo supervisorctl restart backend"
echo ""
echo "Посмотреть логи:"
echo "  tail -f /var/log/supervisor/backend.err.log"
echo ""
echo "Обновить из GitHub:"
echo "  cd $INSTALL_DIR && git pull origin $BRANCH"
echo "  sudo supervisorctl restart backend"
echo ""
echo "════════════════════════════════════════════════════════════════════════════════"

# Если frontend не запустился - показать как исправить
if ! supervisorctl status frontend | grep -q "RUNNING"; then
    echo ""
    echo "⚠️  Frontend не запустился из-за конфликтов npm зависимостей"
    echo ""
    echo "Для исправления выполните:"
    echo "  cd /app/frontend"
    echo "  rm -rf node_modules package-lock.json"
    echo "  npm install --legacy-peer-deps --force"
    echo "  npm install ajv@latest --legacy-peer-deps"
    echo "  sudo supervisorctl restart frontend"
    echo ""
    echo "Или используйте только Backend API: http://$(hostname -I | awk '{print $1}'):8001/docs"
    echo ""
fi

# Проверка критических проблем
if ! [ -e /dev/ppp ]; then
    echo ""
    print_error "/dev/ppp не найден - PPTP не будет работать!"
fi

if ! capsh --print 2>/dev/null | grep -q "cap_net_admin"; then
    echo ""
    print_warning "CAP_NET_ADMIN capability отсутствует!"
    echo "   Для Docker контейнера добавьте: --cap-add=NET_ADMIN"
    echo "   PPTP туннели НЕ БУДУТ работать без этого!"
fi

echo ""
echo "════════════════════════════════════════════════════════════════════════════════"
echo -e "${GREEN}✅ Готово! Приятной работы!${NC}"
echo "════════════════════════════════════════════════════════════════════════════════"
echo ""

exit 0
