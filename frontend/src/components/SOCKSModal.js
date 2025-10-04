import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { toast } from '../hooks/use-toast';
import { 
  Shield, 
  Zap, 
  Database, 
  FileText, 
  Copy, 
  Settings2,
  Activity,
  Lock,
  Globe,
  Server
} from 'lucide-react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';

const SOCKSModal = ({ isOpen, onClose, selectedNodeIds = [] }) => {
  const { API } = useAuth();
  const [loading, setLoading] = useState(false);
  const [socksStats, setSocksStats] = useState({
    active_connections: 0,
    total_tunnels: 0,
    online_socks: 0
  });

  // Настройки маскировки
  const [maskingSettings, setMaskingSettings] = useState({
    obfuscation: true,
    http_imitation: true,
    timing_randomization: true,
    tunnel_encryption: true
  });

  // Настройки производительности
  const [performanceSettings, setPerformanceSettings] = useState({
    tunnel_limit: 100,
    auto_scaling: true,
    cpu_threshold: 80,
    ram_threshold: 80
  });

  // Настройки безопасности
  const [securitySettings, setSecuritySettings] = useState({
    whitelist_enabled: false,
    allowed_ips: []
  });

  const [newAllowedIp, setNewAllowedIp] = useState('');
  const [activeProxies, setActiveProxies] = useState([]);
  const [proxyFileContent, setProxyFileContent] = useState('');

  // Загрузка данных при открытии модала
  useEffect(() => {
    if (isOpen) {
      loadSOCKSData();
    }
  }, [isOpen]);

  const loadSOCKSData = async () => {
    try {
      // Загрузка статистики SOCKS
      const statsResponse = await axios.get(`${API}/socks/stats`);
      setSocksStats(statsResponse.data);

      // Загрузка настроек
      const configResponse = await axios.get(`${API}/socks/config`);
      const config = configResponse.data;
      setMaskingSettings(config.masking || maskingSettings);
      setPerformanceSettings(config.performance || performanceSettings);
      setSecuritySettings(config.security || securitySettings);

      // Загрузка активных прокси
      const proxiesResponse = await axios.get(`${API}/socks/active`);
      setActiveProxies(proxiesResponse.data.proxies || []);

      // Загрузка содержимого файла прокси
      const fileResponse = await axios.get(`${API}/socks/proxy-file`);
      setProxyFileContent(fileResponse.data.content || '');

    } catch (error) {
      console.error('Error loading SOCKS data:', error);
      // Если endpoints не существуют, используем заглушки
      setSocksStats({ active_connections: 0, total_tunnels: 0, online_socks: 0 });
      setActiveProxies([]);
      setProxyFileContent('# SOCKS прокси файл будет создан после запуска сервисов\n');
    }
  };

  const handleStartSocks = async () => {
    if (selectedNodeIds.length === 0) {
      toast.error('Выберите узлы для запуска SOCKS сервисов');
      return;
    }

    setLoading(true);
    try {
      const response = await axios.post(`${API}/socks/start`, {
        node_ids: selectedNodeIds,
        masking_settings: maskingSettings,
        performance_settings: performanceSettings,
        security_settings: securitySettings
      });

      const results = response.data.results;
      const successCount = results.filter(r => r.success).length;
      const failCount = results.length - successCount;

      if (successCount > 0) {
        toast.success(`✅ SOCKS запущен для ${successCount} узлов`);
      }
      if (failCount > 0) {
        toast.error(`❌ Не удалось запустить ${failCount} SOCKS сервисов`);
      }

      // Обновляем данные
      await loadSOCKSData();

    } catch (error) {
      console.error('Error starting SOCKS:', error);
      toast.error('Ошибка запуска SOCKS: ' + (error.response?.data?.detail || error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleStopSocks = async () => {
    if (selectedNodeIds.length === 0) {
      toast.error('Выберите узлы для остановки SOCKS сервисов');
      return;
    }

    setLoading(true);
    try {
      const response = await axios.post(`${API}/socks/stop`, {
        node_ids: selectedNodeIds
      });

      const results = response.data.results;
      const successCount = results.filter(r => r.success).length;

      if (successCount > 0) {
        toast.success(`🛑 SOCKS остановлен для ${successCount} узлов`);
      }

      await loadSOCKSData();

    } catch (error) {
      console.error('Error stopping SOCKS:', error);
      toast.error('Ошибка остановки SOCKS: ' + (error.response?.data?.detail || error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveConfig = async () => {
    setLoading(true);
    try {
      await axios.post(`${API}/socks/config`, {
        masking: maskingSettings,
        performance: performanceSettings,
        security: securitySettings
      });
      toast.success('✅ Настройки SOCKS сохранены');
    } catch (error) {
      console.error('Error saving config:', error);
      toast.error('Ошибка сохранения настроек: ' + (error.response?.data?.detail || error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleAddAllowedIp = () => {
    if (newAllowedIp.trim()) {
      setSecuritySettings(prev => ({
        ...prev,
        allowed_ips: [...prev.allowed_ips, newAllowedIp.trim()]
      }));
      setNewAllowedIp('');
    }
  };

  const handleRemoveAllowedIp = (index) => {
    setSecuritySettings(prev => ({
      ...prev,
      allowed_ips: prev.allowed_ips.filter((_, i) => i !== index)
    }));
  };

  const handleViewDatabase = async () => {
    try {
      const response = await axios.get(`${API}/socks/database-report`);
      // Здесь можно открыть новое модальное окно или скачать отчет
      const blob = new Blob([response.data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `socks_database_report_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('📊 Отчет БД SOCKS скачан');
    } catch (error) {
      console.error('Error downloading database report:', error);
      toast.error('Ошибка скачивания отчета БД');
    }
  };

  const handleOpenProxyFile = () => {
    const blob = new Blob([proxyFileContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'active_proxies.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('📄 Файл прокси скачан');
  };

  const handleCopyCredentials = async () => {
    if (activeProxies.length === 0) {
      toast.error('Нет активных SOCKS прокси для копирования');
      return;
    }

    const credentials = activeProxies.map(proxy => 
      `socks5://${proxy.login}:${proxy.password}@${proxy.ip}:${proxy.port}`
    ).join('\n');

    try {
      await navigator.clipboard.writeText(credentials);
      toast.success(`📋 Скопировано ${activeProxies.length} SOCKS credentials`);
    } catch (error) {
      console.error('Error copying to clipboard:', error);
      toast.error('Ошибка копирования в буфер обмена');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-6 w-6 text-blue-600" />
            SOCKS Управление и Настройки
          </DialogTitle>
          <DialogDescription>
            Управление SOCKS5 сервисами с маскировкой трафика и мониторингом
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Левая колонка: Статистика и управление */}
          <div className="space-y-4">
            {/* Статистика SOCKS */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  SOCKS Статистика
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold text-green-600">{socksStats.online_socks}</div>
                    <div className="text-sm text-gray-600">Online</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-blue-600">{socksStats.total_tunnels}</div>
                    <div className="text-sm text-gray-600">Туннели</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-purple-600">{socksStats.active_connections}</div>
                    <div className="text-sm text-gray-600">Соединения</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Управление SOCKS */}
            <Card>
              <CardHeader>
                <CardTitle>Старт Сервис</CardTitle>
                <CardDescription>
                  Выбрано узлов: {selectedNodeIds.length}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Button 
                    onClick={handleStartSocks}
                    disabled={loading || selectedNodeIds.length === 0}
                    className="bg-green-600 hover:bg-green-700 flex-1"
                  >
                    <Zap className="h-4 w-4 mr-2" />
                    Старт SOCKS
                  </Button>
                  <Button 
                    onClick={handleStopSocks}
                    disabled={loading || selectedNodeIds.length === 0}
                    variant="destructive"
                    className="flex-1"
                  >
                    <Server className="h-4 w-4 mr-2" />
                    Стоп SOCKS
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Действия с файлами и БД */}
            <Card>
              <CardHeader>
                <CardTitle>Управление Данными</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <Button onClick={handleViewDatabase} variant="outline" className="w-full">
                    <Database className="h-4 w-4 mr-2" />
                    Смотреть базу отчет
                  </Button>
                  <Button onClick={handleOpenProxyFile} variant="outline" className="w-full">
                    <FileText className="h-4 w-4 mr-2" />
                    Открыть текстовый файл
                  </Button>
                  <Button onClick={handleCopyCredentials} variant="outline" className="w-full">
                    <Copy className="h-4 w-4 mr-2" />
                    Копировать credentials
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Правая колонка: Настройки */}
          <div className="space-y-4">
            {/* Настройки маскировки */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Lock className="h-5 w-5" />
                  Настройки Маскировки
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label htmlFor="obfuscation">Обфускация протокола</Label>
                  <Switch 
                    id="obfuscation"
                    checked={maskingSettings.obfuscation}
                    onCheckedChange={(checked) => 
                      setMaskingSettings(prev => ({ ...prev, obfuscation: checked }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="http_imitation">Имитация HTTP/HTTPS</Label>
                  <Switch 
                    id="http_imitation"
                    checked={maskingSettings.http_imitation}
                    onCheckedChange={(checked) => 
                      setMaskingSettings(prev => ({ ...prev, http_imitation: checked }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="timing_randomization">Рандомизация timing</Label>
                  <Switch 
                    id="timing_randomization"
                    checked={maskingSettings.timing_randomization}
                    onCheckedChange={(checked) => 
                      setMaskingSettings(prev => ({ ...prev, timing_randomization: checked }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="tunnel_encryption">Шифрование туннеля</Label>
                  <Switch 
                    id="tunnel_encryption"
                    checked={maskingSettings.tunnel_encryption}
                    onCheckedChange={(checked) => 
                      setMaskingSettings(prev => ({ ...prev, tunnel_encryption: checked }))
                    }
                  />
                </div>
              </CardContent>
            </Card>

            {/* Настройки производительности */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings2 className="h-5 w-5" />
                  Настройки Производительности
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="tunnel_limit">Лимит туннелей</Label>
                  <Input
                    id="tunnel_limit"
                    type="number"
                    value={performanceSettings.tunnel_limit}
                    onChange={(e) => 
                      setPerformanceSettings(prev => ({ 
                        ...prev, 
                        tunnel_limit: parseInt(e.target.value) || 100 
                      }))
                    }
                    placeholder="100"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="auto_scaling">Автоматическое увеличение</Label>
                  <Switch 
                    id="auto_scaling"
                    checked={performanceSettings.auto_scaling}
                    onCheckedChange={(checked) => 
                      setPerformanceSettings(prev => ({ ...prev, auto_scaling: checked }))
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="cpu_threshold">CPU порог (%)</Label>
                    <Input
                      id="cpu_threshold"
                      type="number"
                      value={performanceSettings.cpu_threshold}
                      onChange={(e) => 
                        setPerformanceSettings(prev => ({ 
                          ...prev, 
                          cpu_threshold: parseInt(e.target.value) || 80 
                        }))
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="ram_threshold">RAM порог (%)</Label>
                    <Input
                      id="ram_threshold"
                      type="number"
                      value={performanceSettings.ram_threshold}
                      onChange={(e) => 
                        setPerformanceSettings(prev => ({ 
                          ...prev, 
                          ram_threshold: parseInt(e.target.value) || 80 
                        }))
                      }
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Настройки безопасности */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="h-5 w-5" />
                  Настройки Безопасности
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label htmlFor="whitelist_enabled">Whitelist IP адресов</Label>
                  <Switch 
                    id="whitelist_enabled"
                    checked={securitySettings.whitelist_enabled}
                    onCheckedChange={(checked) => 
                      setSecuritySettings(prev => ({ ...prev, whitelist_enabled: checked }))
                    }
                  />
                </div>
                
                {securitySettings.whitelist_enabled && (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Input
                        placeholder="192.168.1.1"
                        value={newAllowedIp}
                        onChange={(e) => setNewAllowedIp(e.target.value)}
                      />
                      <Button onClick={handleAddAllowedIp} size="sm">
                        Добавить
                      </Button>
                    </div>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {securitySettings.allowed_ips.map((ip, index) => (
                        <div key={index} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                          <span className="text-sm">{ip}</span>
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            onClick={() => handleRemoveAllowedIp(index)}
                          >
                            ✕
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <Separator />

        <div className="flex justify-between">
          <Button variant="outline" onClick={onClose}>
            Закрыть
          </Button>
          <Button onClick={handleSaveConfig} disabled={loading}>
            <Settings2 className="h-4 w-4 mr-2" />
            Сохранить Настройки
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SOCKSModal;