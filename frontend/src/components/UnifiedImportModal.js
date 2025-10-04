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
  const [isImportActive, setIsImportActive] = useState(false);

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

    console.log(`Import file size: ${(dataSize/1024).toFixed(1)}KB, isLarge: ${isLarge}`);
    setSubmitting(true);
    
    if (isLarge) {
      // Large file - use chunked processing immediately
      try {
        console.log('Using chunked processing for large file');
        toast.info(`📂 Обнаружен большой файл (${(dataSize/1024).toFixed(1)}KB). Используем безопасную обработку по частям...`);
        
        // Use chunked endpoint for large files
        const response = await axios.post(`${API}/nodes/import/chunked`, {
          data: importData,
          protocol,
          testing_mode: 'no_test'
        });

        const { session_id, message } = response.data || {};

        if (session_id) {
          console.log('Chunked processing started, session_id:', session_id);
          setSessionId(session_id);
          setIsImportActive(true);
          toast.success('🚀 Запущена chunked обработка большого файла...');
          startProgressTracking(session_id);
          return;
        } else {
          console.error('No session_id received:', response.data);
          throw new Error(message || 'Не удалось запустить chunked processing');
        }
      } catch (error) {
        console.error('Chunked import error:', error);
        toast.error('❌ Ошибка chunked обработки: ' + (error.response?.data?.message || error.message));
        setSubmitting(false);
        return;
      }
    }

    // Small file - use regular processing
    try {
      const response = await axios.post(`${API}/nodes/import`, {
        data: importData,
        protocol,
        testing_mode: 'no_test'
      });

      const { success, report, message } = response.data || {};

      if (!success) {
        toast.error(message || 'Ошибка импорта');
        setSubmitting(false);
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
      setSubmitting(false);
    }
  };

  const cancelImport = async () => {
    if (!sessionId) return;
    
    try {
      await axios.delete(`${API}/import/cancel/${sessionId}`);
      toast.info('⏹️ Импорт отменён');
      setSubmitting(false);
      setProgress(null);
      setSessionId(null);
    } catch (error) {
      console.error('Cancel error:', error);
      toast.error('Не удалось отменить импорт');
    }
  };

  const startProgressTracking = (sessionId) => {
    console.log('Starting progress tracking for session:', sessionId);
    let progressInterval;
    
    const trackProgress = async () => {
      try {
        const response = await axios.get(`${API}/import/progress/${sessionId}`);
        const progressData = response.data;
        
        console.log('Progress update:', progressData);
        setProgress(progressData);
        
        if (progressData.status === 'completed' || progressData.status === 'cancelled') {
          if (progressInterval) {
            clearInterval(progressInterval);
          }
          
          setSubmitting(false);
          setSessionId(null);
          
          if (progressData.status === 'completed') {
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
          } else if (progressData.status === 'cancelled') {
            toast.info('⏹️ Импорт отменён пользователем');
          }
          return;
        }
        
        if (progressData.status === 'error') {
          if (progressInterval) {
            clearInterval(progressInterval);
          }
          setSubmitting(false);
          setSessionId(null);
          toast.error('❌ Ошибка импорта: ' + (progressData.message || 'Неизвестная ошибка'));
          return;
        }
      } catch (error) {
        console.error('Progress tracking error:', error);
        if (progressInterval) {
          clearInterval(progressInterval);
        }
        setSubmitting(false);
        setSessionId(null);
        toast.error('❌ Ошибка отслеживания прогресса');
      }
    };
    
    // Initial call
    trackProgress();
    
    // Set up interval for regular updates
    progressInterval = setInterval(trackProgress, 2000); // Update every 2 seconds
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
          {/* Progress Report для chunked импорта */}
          {(submitting || isImportActive) && sessionId && (
            <Card className="border-blue-200 bg-blue-50">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center">
                    <Activity className="h-4 w-4 mr-2 text-blue-600" />
                    📂 Обработка большого файла...
                  </CardTitle>
                  <div className="flex space-x-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={onClose}
                    >
                      📋 Свернуть в фон
                    </Button>
                    <Button 
                      variant="destructive" 
                      size="sm" 
                      onClick={cancelImport}
                      disabled={!sessionId}
                    >
                      ⏹️ Отменить
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Progress Bar with Enhanced Info */}
                <div className="space-y-2">
                  {/* Main Progress Display */}
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">
                      {Math.round(((progress?.processed_chunks || 0) / (progress?.total_chunks || 1)) * 100)}%
                    </div>
                    <div className="text-sm text-gray-600">
                      Обработано {progress?.processed_chunks || 0} из {progress?.total_chunks || 0} частей
                    </div>
                  </div>
                  
                  {/* Visual Progress Bar */}
                  <div className="relative w-full bg-gray-200 rounded-full h-4 overflow-hidden">
                    <div 
                      className="bg-gradient-to-r from-blue-500 to-blue-600 h-4 rounded-full transition-all duration-500 ease-out flex items-center justify-end pr-2"
                      style={{ width: `${Math.max(((progress?.processed_chunks || 0) / (progress?.total_chunks || 1)) * 100, 5)}%` }}
                    >
                      <span className="text-xs text-white font-semibold">
                        {progress?.processed_chunks > 0 ? `${Math.round(((progress?.processed_chunks || 0) / (progress?.total_chunks || 1)) * 100)}%` : ''}
                      </span>
                    </div>
                  </div>
                  
                  {/* Processing Speed Info */}
                  {progress?.processed_chunks > 0 && (
                    <div className="text-xs text-center text-gray-500">
                      🚀 Скорость: ~{Math.max(1, Math.round((progress.added + progress.skipped) / Math.max(1, progress.processed_chunks) * 10))} узлов/сек
                    </div>
                  )}
                </div>
                
                {/* Detailed Statistics */}
                <div className="grid grid-cols-4 gap-2 text-sm">
                  <div className="text-center p-3 bg-green-100 rounded-lg border border-green-200">
                    <div className="text-xl font-bold text-green-800">{progress?.added || 0}</div>
                    <div className="text-xs text-green-600">✅ Добавлено</div>
                  </div>
                  <div className="text-center p-3 bg-yellow-100 rounded-lg border border-yellow-200">
                    <div className="text-xl font-bold text-yellow-800">{progress?.skipped || 0}</div>
                    <div className="text-xs text-yellow-600">⚠️ Пропущено</div>
                  </div>
                  <div className="text-center p-3 bg-red-100 rounded-lg border border-red-200">
                    <div className="text-xl font-bold text-red-800">{progress?.errors || 0}</div>
                    <div className="text-xs text-red-600">❌ Ошибок</div>
                  </div>
                  <div className="text-center p-3 bg-blue-100 rounded-lg border border-blue-200">
                    <div className="text-xl font-bold text-blue-800">
                      {((progress?.added || 0) + (progress?.skipped || 0) + (progress?.errors || 0))}
                    </div>
                    <div className="text-xs text-blue-600">📊 Всего</div>
                  </div>
                </div>
                
                {/* Current Operation with Timestamp */}
                <div className="bg-gray-50 border border-gray-200 p-3 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-gray-700">💼 Текущая операция</span>
                    <span className="text-xs text-gray-500">
                      {new Date().toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-sm text-gray-800 bg-white p-2 rounded border">
                    {progress?.current_operation || 'Инициализация обработки...'}
                  </div>
                  
                  {/* Progress Status Indicator */}
                  <div className="flex items-center mt-2 space-x-2">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                    </div>
                    <span className="text-xs text-blue-600 font-medium">Активная обработка</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Простой индикатор для обычного импорта */}
          {submitting && !sessionId && (
            <Card className="border-green-200 bg-green-50">
              <CardContent className="py-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-center space-x-3">
                    <Activity className="h-6 w-6 text-green-600 animate-spin" />
                    <span className="text-lg font-semibold text-green-800">Обработка файла</span>
                  </div>
                  
                  {/* Simple Progress Animation */}
                  <div className="w-full bg-green-200 rounded-full h-2">
                    <div className="bg-green-600 h-2 rounded-full animate-pulse w-full"></div>
                  </div>
                  
                  <div className="text-center text-sm text-green-700">
                    📂 Файл обрабатывается напрямую (размер &lt; 500KB)
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          
          {/* Настройки импорта */}
          {!submitting && (
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
          )}

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

          {/* Progress bar for large file processing */}
          {progress && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center">
                  <Activity className="h-4 w-4 mr-2 animate-spin" />
                  Обработка большого файла
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span>Прогресс:</span>
                    <span>{progress.processed_chunks}/{progress.total_chunks} частей</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                      style={{ width: `${(progress.processed_chunks / progress.total_chunks) * 100}%` }}
                    ></div>
                  </div>
                  <div className="text-xs text-gray-600">{progress.current_operation}</div>
                  {progress.added > 0 && (
                    <div className="grid grid-cols-4 gap-2 text-xs">
                      <div className="text-center">
                        <div className="font-bold text-green-600">{progress.added}</div>
                        <div>Добавлено</div>
                      </div>
                      <div className="text-center">
                        <div className="font-bold text-yellow-600">{progress.skipped}</div>
                        <div>Дубликатов</div>
                      </div>
                      <div className="text-center">
                        <div className="font-bold text-blue-600">{progress.replaced}</div>
                        <div>Заменено</div>
                      </div>
                      <div className="text-center">
                        <div className="font-bold text-red-600">{progress.errors}</div>
                        <div>Ошибок</div>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

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
                {submitting ? (
                  progress ? 
                    `Обработка... (${progress.processed_chunks}/${progress.total_chunks})` : 
                    'Выполняется...'
                ) : 'Импортировать узлы'}
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
