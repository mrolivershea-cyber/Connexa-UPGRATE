import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Upload, Plus, FileText } from 'lucide-react';
import axios from 'axios';

const UnifiedImportModal = ({ isOpen, onClose, onComplete }) => {
  const { API } = useAuth();
  const [activeTab, setActiveTab] = useState('manual');
  
  // Manual Add State
  const [loadingManual, setLoadingManual] = useState(false);
  const [autoTest, setAutoTest] = useState(true);
  const [testType, setTestType] = useState('ping');
  const [formData, setFormData] = useState({
    protocol: 'pptp',
    ip: '',
    port: '',
    login: '',
    password: '',
    provider: '',
    country: '',
    state: '',
    city: '',
    zipcode: '',
    comment: ''
  });

  // Bulk Import State
  const [loadingImport, setLoadingImport] = useState(false);
  const [importData, setImportData] = useState('');
  const [protocol, setProtocol] = useState('pptp');
  const [previewResult, setPreviewResult] = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  React.useEffect(() => {
    if (isOpen) {
      // Reset Manual form
      setFormData({
        protocol: 'pptp',
        ip: '',
        port: '',
        login: '',
        password: '',
        provider: '',
        country: '',
        state: '',
        city: '',
        zipcode: '',
        comment: ''
      });
      setAutoTest(true);
      setTestType('ping');
      
      // Reset Import form
      setImportData('');
      setProtocol('pptp');
      setPreviewResult(null);
      setShowPreview(false);
      
      // Reset to manual tab
      setActiveTab('manual');
    }
  }, [isOpen]);

  // ============ Manual Add Functions ============
  const handleManualSubmit = async (e) => {
    e.preventDefault();
    setLoadingManual(true);

    try {
      if (autoTest) {
        const response = await axios.post(`${API}/nodes/auto-test?test_type=${testType}`, formData);
        const node = response.data.node;
        const testResult = response.data.test_result;
        
        toast.success(`${formData.protocol?.toUpperCase() || 'PPTP'} узел добавлен и протестирован!`);
        
        if (testResult.ping) {
          const ping = testResult.ping;
          if (ping.reachable) {
            toast.success(`✅ Ping: ${ping.avg_latency}ms, потери: ${ping.packet_loss}%`);
          } else {
            toast.warning('⚠️ Узел недоступен по ping');
          }
        }
        
        if (testResult.speed && testResult.speed.success) {
          const speed = testResult.speed;
          toast.info(`🌐 Скорость: ⬇️${speed.download} Mbps ⬆️${speed.upload} Mbps`);
        }
      } else {
        await axios.post(`${API}/nodes`, formData);
        toast.success(`${formData.protocol?.toUpperCase() || 'PPTP'} узел добавлен успешно!`);
      }
      
      onComplete();
      onClose();
    } catch (error) {
      console.error('Error adding node:', error);
      const errorMsg = error.response?.data?.detail || 'Ошибка добавления узла';
      toast.error(errorMsg);
    } finally {
      setLoadingManual(false);
    }
  };

  const handleManualChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // ============ Bulk Import Functions ============
  const addSampleText = () => {
    const sampleTexts = {
      pptp: `Format 1 - Key-value pairs:
Ip: 144.229.29.35
Login: admin
Pass: admin
State: California
City: Los Angeles
Zip: 90035
---------------------
Format 2 - Single line with spaces (IP Pass Login State):
76.178.64.46 admin admin CA
96.234.52.227 admin admin NJ
---------------------
Format 3 - Dash/pipe format:
68.227.241.4 - admin:admin - Arizona/Phoenix 85001 | 2025-09-03 16:05:25
96.42.187.97 - 1:1 - Michigan/Lapeer 48446 | 2025-09-03 09:50:22
---------------------
Format 4 - Colon separated:
70.171.218.52:admin:admin:US:Arizona:85001
---------------------
Format 5 - Multi-line with Location:
IP: 24.227.222.13
Credentials: admin:admin
Location: Texas (Austin)
ZIP: 78701
---------------------
Format 6 - With PPTP header (first 2 lines ignored):
> PPTP_SVOIM_VPN:
🚨 PPTP Connection
IP: 24.227.222.13
Credentials: admin:admin
Location: Texas (Austin)
ZIP: 78701`,
      ssh: `192.168.1.100:root:password123:US:New York:10001
10.0.0.50 secret456 admin CA`,
      socks: `proxy1.example.com:1080:user:pass:US:California:90210
proxy2.example.com:1080:user2:pass2:GB:London:`,
      server: `server1.example.com admin password US
server2.example.com root secret CA`,
      ovpn: `vpn1.example.com:1194:client1:pass123:US:Florida:33101
vpn2.example.com:443:client2:pass456:GB:London:`
    };
    setImportData(sampleTexts[protocol] || sampleTexts.pptp);
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      setImportData(e.target.result);
      toast.success('File loaded successfully');
    };
    reader.onerror = () => {
      toast.error('Failed to read file');
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!importData.trim()) {
      toast.error('Please enter or upload data to import');
      return;
    }

    setLoadingImport(true);
    try {
      const response = await axios.post(`${API}/nodes/import`, {
        data: importData,
        protocol
      });
      
      if (response.data.success) {
        const report = response.data.report;
        setPreviewResult(report);
        setShowPreview(true);
        
        let message = `Import complete: ${report.added} added`;
        if (report.skipped_duplicates > 0) message += `, ${report.skipped_duplicates} duplicates`;
        if (report.replaced_old > 0) message += `, ${report.replaced_old} replaced`;
        if (report.queued_for_verification > 0) message += `, ${report.queued_for_verification} queued`;
        if (report.format_errors > 0) message += `, ${report.format_errors} format errors`;
        
        toast.success(message);
        onComplete(report);
      } else {
        toast.error(response.data.message || 'Import failed');
      }
    } catch (error) {
      console.error('Error importing:', error);
      const errorMsg = error.response?.data?.message || 'Failed to import data';
      toast.error(errorMsg);
    } finally {
      setLoadingImport(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto" data-testid="unified-import-modal">
        <DialogHeader>
          <DialogTitle>Импорт узлов</DialogTitle>
          <DialogDescription>
            Добавьте узлы вручную или импортируйте из текстовых данных
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="manual" data-testid="manual-tab">
              <Plus className="h-4 w-4 mr-2" />
              Добавить вручную
            </TabsTrigger>
            <TabsTrigger value="bulk" data-testid="bulk-tab">
              <FileText className="h-4 w-4 mr-2" />
              Импорт из текста
            </TabsTrigger>
          </TabsList>

          {/* ============ Manual Add Tab ============ */}
          <TabsContent value="manual" className="space-y-4 mt-4">
            <form onSubmit={handleManualSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {/* Protocol */}
                <div className="space-y-2">
                  <Label htmlFor="manual-protocol">Протокол *</Label>
                  <Select 
                    value={formData.protocol} 
                    onValueChange={(value) => handleManualChange('protocol', value)}
                  >
                    <SelectTrigger data-testid="manual-protocol-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pptp">PPTP</SelectItem>
                      <SelectItem value="ssh">SSH</SelectItem>
                      <SelectItem value="socks">SOCKS</SelectItem>
                      <SelectItem value="server">SERVER</SelectItem>
                      <SelectItem value="ovpn">OVPN</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* IP */}
                <div className="space-y-2">
                  <Label htmlFor="manual-ip">IP адрес *</Label>
                  <Input
                    id="manual-ip"
                    value={formData.ip}
                    onChange={(e) => handleManualChange('ip', e.target.value)}
                    placeholder="192.168.1.1"
                    required
                    data-testid="manual-ip-input"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Port */}
                <div className="space-y-2">
                  <Label htmlFor="manual-port">Порт</Label>
                  <Input
                    id="manual-port"
                    value={formData.port}
                    onChange={(e) => handleManualChange('port', e.target.value)}
                    placeholder="1723"
                    data-testid="manual-port-input"
                  />
                </div>

                {/* Provider */}
                <div className="space-y-2">
                  <Label htmlFor="manual-provider">Провайдер</Label>
                  <Input
                    id="manual-provider"
                    value={formData.provider}
                    onChange={(e) => handleManualChange('provider', e.target.value)}
                    placeholder="ISP Name"
                    data-testid="manual-provider-input"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Login */}
                <div className="space-y-2">
                  <Label htmlFor="manual-login">Логин *</Label>
                  <Input
                    id="manual-login"
                    value={formData.login}
                    onChange={(e) => handleManualChange('login', e.target.value)}
                    placeholder="username"
                    required
                    data-testid="manual-login-input"
                  />
                </div>

                {/* Password */}
                <div className="space-y-2">
                  <Label htmlFor="manual-password">Пароль *</Label>
                  <Input
                    id="manual-password"
                    type="password"
                    value={formData.password}
                    onChange={(e) => handleManualChange('password', e.target.value)}
                    placeholder="••••••••"
                    required
                    data-testid="manual-password-input"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                {/* Country */}
                <div className="space-y-2">
                  <Label htmlFor="manual-country">Страна</Label>
                  <Input
                    id="manual-country"
                    value={formData.country}
                    onChange={(e) => handleManualChange('country', e.target.value)}
                    placeholder="USA"
                    data-testid="manual-country-input"
                  />
                </div>

                {/* State */}
                <div className="space-y-2">
                  <Label htmlFor="manual-state">Штат</Label>
                  <Input
                    id="manual-state"
                    value={formData.state}
                    onChange={(e) => handleManualChange('state', e.target.value)}
                    placeholder="California"
                    data-testid="manual-state-input"
                  />
                </div>

                {/* City */}
                <div className="space-y-2">
                  <Label htmlFor="manual-city">Город</Label>
                  <Input
                    id="manual-city"
                    value={formData.city}
                    onChange={(e) => handleManualChange('city', e.target.value)}
                    placeholder="Los Angeles"
                    data-testid="manual-city-input"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* ZIP Code */}
                <div className="space-y-2">
                  <Label htmlFor="manual-zipcode">ZIP код</Label>
                  <Input
                    id="manual-zipcode"
                    value={formData.zipcode}
                    onChange={(e) => handleManualChange('zipcode', e.target.value)}
                    placeholder="90001"
                    data-testid="manual-zipcode-input"
                  />
                </div>

                {/* Comment */}
                <div className="space-y-2">
                  <Label htmlFor="manual-comment">Комментарий</Label>
                  <Input
                    id="manual-comment"
                    value={formData.comment}
                    onChange={(e) => handleManualChange('comment', e.target.value)}
                    placeholder="Optional note"
                    data-testid="manual-comment-input"
                  />
                </div>
              </div>

              {/* Auto Test Options */}
              <div className="space-y-3 p-4 border rounded-lg bg-gray-50">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="auto-test"
                    checked={autoTest}
                    onCheckedChange={setAutoTest}
                    data-testid="manual-autotest-checkbox"
                  />
                  <Label htmlFor="auto-test" className="cursor-pointer">
                    Автоматически протестировать узел после добавления
                  </Label>
                </div>

                {autoTest && (
                  <div className="space-y-2 ml-6">
                    <Label htmlFor="test-type">Тип теста</Label>
                    <Select value={testType} onValueChange={setTestType}>
                      <SelectTrigger data-testid="manual-testtype-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ping">Ping только</SelectItem>
                        <SelectItem value="speed">Ping + Тест скорости</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={onClose}>
                  Отмена
                </Button>
                <Button 
                  type="submit"
                  disabled={loadingManual || !formData.ip || !formData.login || !formData.password}
                  data-testid="manual-submit-btn"
                >
                  {loadingManual ? 'Добавление...' : 'Добавить узел'}
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>

          {/* ============ Bulk Import Tab ============ */}
          <TabsContent value="bulk" className="space-y-4 mt-4">
            {/* Protocol Selection */}
            <div className="space-y-2">
              <Label htmlFor="import-protocol">Тип протокола</Label>
              <Select value={protocol} onValueChange={setProtocol}>
                <SelectTrigger data-testid="import-protocol-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pptp">PPTP</SelectItem>
                  <SelectItem value="ssh">SSH</SelectItem>
                  <SelectItem value="socks">SOCKS</SelectItem>
                  <SelectItem value="server">SERVER</SelectItem>
                  <SelectItem value="ovpn">OVPN</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Import Data */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="import-data">Данные для импорта</Label>
                <div className="flex space-x-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addSampleText}
                    data-testid="add-sample-text-btn"
                  >
                    Добавить пример
                  </Button>
                  <Label htmlFor="file-upload" className="cursor-pointer">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      asChild
                      data-testid="upload-file-btn"
                    >
                      <span>
                        <Upload className="h-4 w-4 mr-2" />
                        Загрузить файл
                      </span>
                    </Button>
                  </Label>
                  <input
                    id="file-upload"
                    type="file"
                    accept=".txt,.csv"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </div>
              </div>
              <Textarea
                id="import-data"
                value={importData}
                onChange={(e) => setImportData(e.target.value)}
                placeholder="Вставьте данные узлов здесь или загрузите файл..."
                rows={12}
                className="font-mono text-sm"
                data-testid="import-data-textarea"
              />
            </div>

            {/* Supported Formats Help */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Поддерживаемые форматы импорта</CardTitle>
              </CardHeader>
              <CardContent className="text-xs space-y-2">
                <div><strong>Формат 1:</strong> Пары ключ-значение (Ip: xxx, Login: xxx, Pass: xxx)</div>
                <div><strong>Формат 2:</strong> Разделенные пробелами (IP login pass state_code)</div>
                <div><strong>Формат 3:</strong> Формат с тире/вертикальной чертой (IP - login:pass - State/City ZIP | date)</div>
                <div><strong>Формат 4:</strong> Разделенные двоеточием (IP:login:pass:country:state:zip)</div>
                <div><strong>Формат 5/6:</strong> Многострочный с Location: State (City)</div>
              </CardContent>
            </Card>

            {/* Preview Results */}
            {showPreview && previewResult && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Результаты импорта</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                    <div className="text-center">
                      <div className="text-xl font-bold text-green-600">{previewResult.added || 0}</div>
                      <div className="text-xs text-gray-600">Добавлено</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xl font-bold text-yellow-600">{previewResult.skipped_duplicates || 0}</div>
                      <div className="text-xs text-gray-600">Дубликатов</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xl font-bold text-blue-600">{previewResult.replaced_old || 0}</div>
                      <div className="text-xs text-gray-600">Заменено</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xl font-bold text-purple-600">{previewResult.queued_for_verification || 0}</div>
                      <div className="text-xs text-gray-600">В очереди</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xl font-bold text-red-600">{previewResult.format_errors || 0}</div>
                      <div className="text-xs text-gray-600">Ошибок</div>
                    </div>
                  </div>
                  
                  {previewResult.processing_errors > 0 && (
                    <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded">
                      <h4 className="font-medium text-red-600 mb-2">Ошибок обработки: {previewResult.processing_errors}</h4>
                      <div className="text-xs text-red-600">
                        Проверьте журнал ошибок формата для деталей.
                      </div>
                    </div>
                  )}
                  
                  <div className="mt-4 text-xs text-gray-600">
                    <strong>Сводка:</strong> Обработано {previewResult.total_processed} блоков, успешно распознано {previewResult.successfully_parsed}
                  </div>
                </CardContent>
              </Card>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Отмена
              </Button>
              <Button 
                onClick={handleImport}
                disabled={loadingImport || !importData.trim()}
                data-testid="import-btn"
              >
                {loadingImport ? 'Импорт...' : 'Импортировать узлы'}
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default UnifiedImportModal;
