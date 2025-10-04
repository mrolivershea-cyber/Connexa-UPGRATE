import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Upload, Activity } from 'lucide-react';
import axios from 'axios';

const UnifiedImportModal = ({ isOpen, onClose, onComplete }) => {
  const { API } = useAuth();

  // Import form state - simplified (no testing options)
  const [importData, setImportData] = useState('');
  const [protocol, setProtocol] = useState('pptp');
  const [previewResult, setPreviewResult] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isLargeFile, setIsLargeFile] = useState(false);
  const [progress, setProgress] = useState(null);
  const [sessionId, setSessionId] = useState(null);

  useEffect(() => {
    if (isOpen) {
      // Reset form for new import
      setImportData('');
      setProtocol('pptp');
      setPreviewResult(null);
      setShowPreview(false);
      setSubmitting(false);
      setIsLargeFile(false);
      setProgress(null);
      setSessionId(null);
    }
  }, [isOpen]);

  const addSampleText = () => {
    const sampleTexts = {
      pptp: `Format 1 - Key-value pairs:\nIp: 144.229.29.35\nLogin: admin\nPass: admin\nState: California\nCity: Los Angeles\nZip: 90035\n---------------------\nFormat 2 - Single line with spaces (IP Pass Login State):\n76.178.64.46 admin admin CA\n96.234.52.227 admin admin NJ\n---------------------\nFormat 3 - Dash/pipe format:\n68.227.241.4 - admin:admin - Arizona/Phoenix 85001 | 2025-09-03 16:05:25\n96.42.187.97 - 1:1 - Michigan/Lapeer 48446 | 2025-09-03 09:50:22\n---------------------\nFormat 4 - Colon separated:\n70.171.218.52:admin:admin:US:Arizona:85001\n---------------------\nFormat 5 - Multi-line with Location:\nIP: 24.227.222.13\nCredentials: admin:admin\nLocation: Texas (Austin)\nZIP: 78701\n---------------------\nFormat 6 - With PPTP header (first 2 lines ignored):\n> PPTP_SVOIM_VPN:\n🚨 PPTP Connection\nIP: 24.227.222.13\nCredentials: admin:admin\nLocation: Texas (Austin)\nZIP: 78701\n---------------------\nFormat 7 - Simple IP:Login:Pass:\n144.229.29.35:admin:password123\n76.178.64.46:user:pass456\n96.234.52.227:root:secret789`,
      ssh: `192.168.1.100:root:password123:US:New York:10001\n10.0.0.50 secret456 admin CA`,
      socks: `proxy1.example.com:1080:user:pass:US:California:90210\nproxy2.example.com:1080:user2:pass2:GB:London:`,
      server: `server1.example.com admin password US\nserver2.example.com root secret CA`,
      ovpn: `vpn1.example.com:1194:client1:pass123:US:Florida:33101\nvpn2.example.com:443:client2:pass456:GB:London:`
    };
    setImportData(sampleTexts[protocol] || sampleTexts.pptp);
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Check file size
    const fileSizeKB = file.size / 1024;
    const isLarge = fileSizeKB > 500; // 500KB threshold
    
    setIsLargeFile(isLarge);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      setImportData(e.target.result);
      if (isLarge) {
        toast.warning(`📦 Большой файл (${fileSizeKB.toFixed(1)}KB) - будет использована потоковая обработка`);
      } else {
        toast.success('Файл загружен');
      }
    };
    reader.onerror = () => {
      toast.error('Не удалось прочитать файл');
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!importData.trim()) {
      toast.error('Пожалуйста, введите или загрузите данные для импорта');
      return;
    }

    const dataSize = new Blob([importData]).size;
    const isLarge = dataSize > 500 * 1024; // 500KB

    setSubmitting(true);
    try {
      const response = await axios.post(`${API}/nodes/import`, {
        data: importData,
        protocol,
        testing_mode: 'no_test'  // Always no_test in simplified mode
      });

      const { success, report, message, session_id } = response.data || {};

      if (!success) {
        toast.error(message || 'Ошибка импорта');
        setSubmitting(false);
        return;
      }

      // If chunked processing was used
      if (session_id) {
        setSessionId(session_id);
        toast.success('🚀 Запущена обработка большого файла...');
        startProgressTracking(session_id);
        return;
      }

      // Regular processing completed
      setPreviewResult(report || null);
      setShowPreview(true);

      toast.success(`✅ Импорт завершён: ${report?.added || 0} добавлено, ${report?.skipped_duplicates || 0} дубликатов`);
      toast.info('📊 Для тестирования используйте кнопку "Testing" в админ-панели');
      
      setTimeout(() => {
        onClose();
      }, 2000);

      if (onComplete) onComplete(report);
    } catch (error) {
      console.error('Error importing:', error);
      const errorMsg = error.response?.data?.message || 'Не удалось импортировать данные';
      toast.error(errorMsg);
    } finally {
      if (!sessionId) {
        setSubmitting(false);
      }
    }
  };

  const startProgressTracking = (sessionId) => {
    const trackProgress = async () => {
      try {
        const response = await axios.get(`${API}/import/progress/${sessionId}`);
        const progressData = response.data;
        
        setProgress(progressData);
        
        if (progressData.status === 'completed') {
          setSubmitting(false);
          setPreviewResult({
            added: progressData.added,
            skipped_duplicates: progressData.skipped,
            replaced_old: progressData.replaced,
            format_errors: progressData.errors
          });
          setShowPreview(true);
          
          toast.success(`✅ Импорт большого файла завершён: ${progressData.added} добавлено, ${progressData.skipped} дубликатов`);
          toast.info('📊 Для тестирования используйте кнопку "Testing" в админ-панели');
          
          setTimeout(() => {
            onClose();
          }, 3000);
          
          if (onComplete) {
            onComplete({
              added: progressData.added,
              skipped_duplicates: progressData.skipped,
              replaced_old: progressData.replaced
            });
          }
          return;
        } else if (progressData.status === 'failed') {
          setSubmitting(false);
          toast.error(`Ошибка импорта: ${progressData.current_operation}`);
          return;
        }
        
        // Continue tracking
        setTimeout(trackProgress, 2000);
      } catch (error) {
        console.error('Progress tracking error:', error);
        setSubmitting(false);
        toast.error('Ошибка отслеживания прогресса импорта');
      }
    };
    
    // Start tracking after small delay
    setTimeout(trackProgress, 1000);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto" data-testid="unified-import-modal">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center">
              <Activity className="h-5 w-5 mr-2" />
              Импорт узлов
            </DialogTitle>
          </div>
          <DialogDescription>
            Вставьте данные конфигураций. Все новые узлы получат статус "Not Tested". Для тестирования используйте кнопку "Testing".
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Настройки импорта */}
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

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="import-data">Данные для импорта</Label>
              <div className="flex space-x-2">
                <Button type="button" variant="outline" size="sm" onClick={addSampleText} data-testid="add-sample-text-btn">
                  Добавить пример
                </Button>
                <Label htmlFor="file-upload" className="cursor-pointer">
                  <Button type="button" variant="outline" size="sm" asChild data-testid="upload-file-btn">
                    <span>
                      <Upload className="h-4 w-4 mr-2" />
                      Загрузить файл
                    </span>
                  </Button>
                </Label>
                <input id="file-upload" type="file" accept=".txt,.csv" onChange={handleFileUpload} className="hidden" />
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

          {/* Simplified mode - no testing options */}

          {/* Итоговый отчёт импорта */}
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
                    <div className="text-xs text-gray-600">Ошибок формата</div>
                  </div>
                </div>
                {previewResult.processing_errors > 0 && (
                  <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded">
                    <h4 className="font-medium text-red-600 mb-2">Ошибок обработки: {previewResult.processing_errors}</h4>
                    <div className="text-xs text-red-600">Проверьте журнал ошибок формата для деталей.</div>
                  </div>
                )}
                {previewResult.smart_summary && (
                  <div className="mt-4 text-sm text-gray-700">{previewResult.smart_summary}</div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter>
          <div className="flex space-x-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Закрыть
            </Button>
            {!showPreview ? (
              <Button onClick={handleImport} disabled={submitting || !importData.trim()} data-testid="import-btn">
                {submitting ? 'Выполняется...' : 'Импортировать узлы'}
              </Button>
            ) : (
              <Button onClick={onClose} variant="default" data-testid="close-after-import-btn">
                Готово
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default UnifiedImportModal;
