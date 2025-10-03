import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { Upload, Minus, X, Activity } from 'lucide-react';
import axios from 'axios';

const UnifiedImportModal = ({ isOpen, onClose, onComplete }) => {
  const { API } = useAuth();
  
  // Import State
  const [loading, setLoading] = useState(false);
  const [importData, setImportData] = useState('');
  const [protocol, setProtocol] = useState('pptp');
  const [testingMode, setTestingMode] = useState('ping_only');
  const [previewResult, setPreviewResult] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  
  // Progress State
  const [isMinimized, setIsMinimized] = useState(false);
  const [progressData, setProgressData] = useState(null);
  const [sessionId, setSessionId] = useState(null);

  React.useEffect(() => {
    if (isOpen) {
      // Reset form
      setImportData('');
      setProtocol('pptp');
      setTestingMode('ping_only');
      setPreviewResult(null);
      setShowPreview(false);
      setProgressData(null);
      setSessionId(null);
      setIsMinimized(false);
    }
  }, [isOpen]);

  // Progress tracking effect
  React.useEffect(() => {
    let eventSource = null;
    
    if (sessionId && loading) {
      eventSource = new EventSource(`${API}/progress/${sessionId}`);
      
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setProgressData(data);
          
          if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
            eventSource.close();
            setLoading(false);
          }
        } catch (error) {
          console.error('Error parsing progress data:', error);
        }
      };
      
      eventSource.onerror = (error) => {
        console.error('SSE Error:', error);
        eventSource.close();
        setLoading(false);
      };
    }
    
    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [sessionId, loading, API]);

  // ============ Import Functions ============
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
      toast.error('Пожалуйста, введите или загрузите данные для импорта');
      return;
    }

    setLoading(true);
    try {
      const response = await axios.post(`${API}/nodes/import`, {
        data: importData,
        protocol,
        testing_mode: testingMode
      });
      
      if (response.data.success) {
        const report = response.data.report;
        
        // If there's a session_id, start progress tracking
        if (response.data.session_id) {
          setSessionId(response.data.session_id);
          // Don't set loading to false yet, let the progress tracking handle it
        } else {
          // No testing, immediate completion
          setLoading(false);
          setPreviewResult(report);
          setShowPreview(true);
          
          // Use smart summary from backend if available
          const message = report.smart_summary || response.data.message;
          
          // Show appropriate toast based on what happened
          if (report.added === 0 && report.skipped_duplicates > 0) {
            toast.info(message, { duration: 5000 });
          } else if (report.added > 0) {
            toast.success(message, { duration: 5000 });
          } else if (report.format_errors > 0) {
            toast.warning(message, { duration: 5000 });
          } else {
            toast.info(message, { duration: 5000 });
          }
          
          onComplete(report);
        }
      } else {
        toast.error(response.data.message || 'Ошибка импорта');
        setLoading(false);
      }
    } catch (error) {
      console.error('Error importing:', error);
      const errorMsg = error.response?.data?.message || 'Не удалось импортировать данные';
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    if (sessionId && loading) {
      try {
        await axios.post(`${API}/progress/${sessionId}/cancel`);
        toast.info('Операция отменена');
      } catch (error) {
        console.error('Error cancelling operation:', error);
      }
    }
    setLoading(false);
    setProgressData(null);
    setSessionId(null);
  };

  const handleMinimize = () => {
    // Close the modal but keep the process running
    onClose();
    // The progress will continue in background and can be accessed via Import button
  };

  // Progress completion handler
  React.useEffect(() => {
    if (progressData && progressData.status === 'completed') {
      // Show final results
      setPreviewResult({
        ...progressData,
        smart_summary: progressData.current_task
      });
      setShowPreview(true);
      toast.success('Импорт и тестирование завершено!');
      
      if (onComplete) {
        onComplete(progressData);
      }
    } else if (progressData && progressData.status === 'failed') {
      toast.error('Ошибка при выполнении операции');
    } else if (progressData && progressData.status === 'cancelled') {
      toast.info('Операция отменена');
    }
  }, [progressData, onComplete]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto" data-testid="unified-import-modal">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center">
              <Activity className="h-5 w-5 mr-2" />
              Импорт узлов
            </DialogTitle>
            {(loading || progressData) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleMinimize}
                className="h-8 w-8 p-0"
                title="Свернуть"
              >
                <Minus className="h-4 w-4" />
              </Button>
            )}
          </div>
          <DialogDescription>
            Введите данные узлов в текстовом формате. Поддерживается импорт как одного узла, так и нескольких.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Progress Display */}
          {loading && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>Прогресс импорта</span>
                  <span className="text-sm font-normal">
                    {progressData ? `${progressData.processed_items}/${progressData.total_items}` : '0/0'}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span>{progressData.current_task || 'Выполняется импорт...'}</span>
                    <span>{progressData.progress_percent || 0}%</span>
                  </div>
                  <Progress 
                    value={progressData.progress_percent || 0} 
                    className="w-full" 
                  />
                  {progressData.results && progressData.results.length > 0 && (
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {progressData.results.slice(-3).map((result, index) => (
                        <div key={index} className="text-xs text-gray-600 flex items-center">
                          <span className={`mr-2 ${result.success ? 'text-green-600' : 'text-red-600'}`}>
                            {result.success ? '✅' : '❌'}
                          </span>
                          {result.ip} - {result.status}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

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

          {/* Preview Results */}
          {showPreview && previewResult && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Результаты импорта</CardTitle>
              </CardHeader>
              <CardContent>
                {/* Smart Summary */}
                {previewResult.smart_summary && (
                  <div className={`mb-4 p-3 rounded border ${
                    previewResult.added === 0 && previewResult.skipped_duplicates > 0
                      ? 'bg-blue-50 border-blue-200'
                      : previewResult.added > 0
                      ? 'bg-green-50 border-green-200'
                      : 'bg-gray-50 border-gray-200'
                  }`}>
                    <p className={`text-sm font-medium ${
                      previewResult.added === 0 && previewResult.skipped_duplicates > 0
                        ? 'text-blue-800'
                        : previewResult.added > 0
                        ? 'text-green-800'
                        : 'text-gray-800'
                    }`}>
                      {previewResult.smart_summary}
                    </p>
                  </div>
                )}
                
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
        </div>

        <DialogFooter>
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <Label className="text-sm">Режим тестирования:</Label>
                <Select value={testingMode} onValueChange={setTestingMode}>
                  <SelectTrigger className="w-[180px]" data-testid="testing-mode-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ping_only">Ping only</SelectItem>
                    <SelectItem value="speed_only">Speed only</SelectItem>
                    <SelectItem value="ping_speed">Ping + Speed</SelectItem>
                    <SelectItem value="no_test">No test</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <div className="flex space-x-2">
              {loading ? (
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={handleCancel}
                  data-testid="cancel-btn"
                >
                  Отменить операцию
                </Button>
              ) : (
                <Button type="button" variant="outline" onClick={onClose}>
                  Закрыть
                </Button>
              )}
              <Button 
                onClick={handleImport}
                disabled={loading || !importData.trim()}
                data-testid="import-btn"
              >
                {loading ? 'Выполняется...' : 'Импортировать узлы'}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default UnifiedImportModal;
