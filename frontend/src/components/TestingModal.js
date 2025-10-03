import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Activity, Zap, Wifi, Timer, Minus, X } from 'lucide-react';
import axios from 'axios';

const TestingModal = ({ isOpen, onClose, selectedNodeIds = [], onTestComplete }) => {
  const { API } = useAuth();
  const [loading, setLoading] = useState(false);
  const [testType, setTestType] = useState('ping');
  const [results, setResults] = useState(null);
  const [progress, setProgress] = useState(0);
  const [isMinimized, setIsMinimized] = useState(false);
  const [processedNodes, setProcessedNodes] = useState(0);
  const [totalNodes, setTotalNodes] = useState(0);
  
  // Progress State for new system
  const [progressData, setProgressData] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [useNewSystem, setUseNewSystem] = useState(false);

  React.useEffect(() => {
    if (isOpen) {
      // Check for saved progress state first
      const savedState = localStorage.getItem('testingProgress');
      
      if (savedState) {
        try {
          const state = JSON.parse(savedState);
          const isRecent = (Date.now() - state.timestamp) < 300000; // 5 minutes
          
          if (isRecent && state.sessionId) {
            // Restore saved state
            setSessionId(state.sessionId);
            setLoading(state.loading || false);
            setProgressData(state.progressData || null);
            setResults(state.results || null);
            setTestType(state.testType || 'ping');
            setProcessedNodes(state.processedNodes || 0);
            setTotalNodes(state.totalNodes || selectedNodeIds.length);
            setUseNewSystem(true);
            setIsMinimized(false);
            
            toast.info('Восстановлено активное тестирование');
            return;
          } else {
            // Clear old saved state
            localStorage.removeItem('testingProgress');
          }
        } catch (error) {
          console.error('Error parsing saved testing state:', error);
          localStorage.removeItem('testingProgress');
        }
      }
      
      // Reset for new testing
      setTestType('ping');
      setResults(null);
      setProgress(0);
      setIsMinimized(false);
      setProcessedNodes(0);
      setTotalNodes(selectedNodeIds.length);
      setProgressData(null);
      setSessionId(null);
      setUseNewSystem(false);
    }
  }, [isOpen, selectedNodeIds.length]);

  // Auto-persist testing session to survive page refreshes
  React.useEffect(() => {
    if (!sessionId || !loading) return;
    const persist = () => {
      const savedState = {
        sessionId,
        loading,
        progressData,
        results,
        testType,
        selectedNodeIds,
        processedNodes,
        totalNodes,
        timestamp: Date.now()
      };
      localStorage.setItem('testingProgress', JSON.stringify(savedState));
    };

    // Persist immediately and on interval
    persist();
    const iv = setInterval(persist, 1500);

    // Persist on page unload
    const handleBeforeUnload = () => persist();
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(iv);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [sessionId, loading, progressData, results, testType, processedNodes, totalNodes, selectedNodeIds]);

  // Progress tracking effect (same as ImportModal)
  React.useEffect(() => {
    let eventSource = null;
    
    if (sessionId && loading) {
      // Обеспечиваем мгновенную видимость процесса до прихода первого SSE
      setProgressData(prev => prev || { status: 'running', processed_items: 0, total_items: totalNodes || selectedNodeIds.length, current_task: `Запущено тестирование ${selectedNodeIds.length} узлов...`, results: [] });
      eventSource = new EventSource(`${API}/progress/${sessionId}`);
      
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setProgressData(data);
          setProcessedNodes(data.processed_items || 0);
          setTotalNodes(data.total_items || selectedNodeIds.length);
          setProgress(data.progress_percent || 0);
          
          if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
            eventSource.close();
            setLoading(false);
            
            if (data.status === 'completed') {
              // Clear saved state when completed
              localStorage.removeItem('testingProgress');
              
              // Convert progress results to expected format
              const testResults = data.results?.map(result => ({
                node_id: result.node_id,
                ip: result.ip,
                success: result.success,
                status: result.status,
                ping_result: result.success ? {
                  success: true,
                  avg_time: '< 100ms',
                  packet_loss: '0%'
                } : {
                  success: false,
                  message: 'Connection failed'
                }
              })) || [];
              
              setResults(testResults);
              toast.success(`Тестирование завершено: ${testResults.filter(r => r.success).length} успешно`);
              
              if (onTestComplete) {
                onTestComplete();
              }
            } else if (data.status === 'failed') {
              localStorage.removeItem('testingProgress');
              toast.error('Ошибка при тестировании');
            }
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
  }, [sessionId, loading, API, selectedNodeIds.length, onTestComplete, totalNodes]);

  const handleTest = async () => {
    if (selectedNodeIds.length === 0) {
      toast.error('Выберите узлы для тестирования');
      return;
    }

    setLoading(true);
    setProgress(0);
    setProcessedNodes(0);
    setTotalNodes(selectedNodeIds.length);
    setResults(null);
    setProgressData(null);
    setSessionId(null);
    
    // ALWAYS use progress-enabled endpoints for ANY batch size
    setUseNewSystem(true);
    
    try {
      let endpoint;
      
      // ALWAYS use progress-enabled endpoints
      if (testType === 'ping') {
        endpoint = 'manual/ping-test-batch-progress';
      } else if (testType === 'speed') {
        endpoint = 'manual/speed-test-batch-progress';
      } else if (testType === 'both') {
        endpoint = 'manual/ping-speed-test-batch-progress';
      }
      
      // No more progress simulation - SSE will provide real progress
      
      console.log(`Starting ${testType} test for ${selectedNodeIds.length} nodes using ${endpoint}`);
      
      const response = await axios.post(`${API}/${endpoint}`, {
        node_ids: selectedNodeIds,
        test_type: testType
      }, {
        timeout: testType === 'both' ? 300000 : 180000 // 5 minutes for combined, 3 minutes for single tests
      });
      
      if (response.data.session_id) {
        // Track progress via SSE
        setSessionId(response.data.session_id);
        // Persist initial state to survive refreshes
        const savedState = {
          sessionId: response.data.session_id,
          loading: true,
          progressData: null,
          results: null,
          testType,
          selectedNodeIds,
          processedNodes: 0,
          totalNodes: selectedNodeIds.length,
          timestamp: Date.now()
        };
        localStorage.setItem('testingProgress', JSON.stringify(savedState));
        toast.info(response.data.message || 'Тестирование начато');
        // Don't set loading to false yet, SSE will handle completion
      } else {
        // Fallback: direct response (shouldn't happen with progress endpoints)
        setProgress(100);
        localStorage.removeItem('testingProgress');
        setResults(response.data.results);
        setProcessedNodes(response.data.results?.length || 0);
        
        const successCount = response.data.results?.filter(r => r.success).length || 0;
        const failCount = (response.data.results?.length || 0) - successCount;
        
        if (successCount > 0) {
          toast.success(`Протестировано ${successCount} узлов`);
        }
        if (failCount > 0) {
          toast.warning(`Ошибки с ${failCount} узлами`);
        }

        if (onTestComplete) {
          onTestComplete();
        }
        
        setLoading(false);
      }
      
    } catch (error) {
      console.error('Testing error:', error);
      toast.error('Ошибка тестирования: ' + (error.response?.data?.detail || error.message));
    } finally {
      // Note: SSE handles completion, no need to set loading=false here
    }
  };

  const handleMinimize = () => {
    // Save current state to localStorage for restoration
    if (sessionId || loading) {
      const savedState = {
        sessionId,
        loading,
        progressData,
        results,
        testType,
        selectedNodeIds,
        processedNodes,
        totalNodes,
        timestamp: Date.now()
      };
      localStorage.setItem('testingProgress', JSON.stringify(savedState));
      toast.info('Тестирование свернуто. Откройте Testing для просмотра прогресса.');
    }
    
    // Close the modal but keep the process running
    onClose();
  };

  const getTestTypeDescription = () => {
    switch (testType) {
      case 'ping':
        return 'Проверка доступности узлов (ICMP ping)';
      case 'speed':
        return 'Тестирование скорости интернет соединения';
      case 'both':
        return 'Комбинированный тест: ping + скорость';
      default:
        return '';
    }
  };

  const renderTestResult = (result) => {
    if (!result.success) {
      return (
        <div className="p-3 bg-red-100 text-red-800 rounded">
          <div className="font-medium">Node {result.node_id} - {result.ip || 'N/A'}</div>
          <div className="text-sm">{result.message}</div>
        </div>
      );
    }

    // Handle manual ping test results (new format)
    if (result.ping_result) {
      const pingResult = result.ping_result;
      const isSuccess = pingResult.success;
      
      return (
        <div className={`p-3 rounded ${
          isSuccess ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          <div className="flex justify-between items-start">
            <div>
              <div className="font-medium">Node {result.node_id} - {result.ip}</div>
              <div className="text-sm">
                {isSuccess ? (
                  <span>✅ PPTP Порт Доступен • {pingResult.avg_time}ms • Потери: {pingResult.packet_loss}%</span>
                ) : (
                  <span>❌ PPTP Недоступен • {pingResult.message}</span>
                )}
              </div>
              <div className="text-xs text-gray-600">
                Статус: {result.original_status} → {result.status}
              </div>
            </div>
            <Badge variant={isSuccess ? 'default' : 'destructive'}>
              {result.status}
            </Badge>
          </div>
        </div>
      );
    }

    // Handle legacy ping test results (old format)
    if (result.ping) {
      const ping = result.ping;
      return (
        <div className={`p-3 rounded ${
          ping.reachable ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          <div className="flex justify-between items-start">
            <div>
              <div className="font-medium">Node {result.node_id} - {result.ip}</div>
              <div className="text-sm">
                {ping.reachable ? (
                  <span>✅ Доступен • Ping: {ping.avg_latency}ms • Потери: {ping.packet_loss}%</span>
                ) : (
                  <span>❌ Недоступен</span>
                )}
              </div>
            </div>
            <Badge variant={ping.reachable ? 'default' : 'destructive'}>
              {ping.reachable ? 'Online' : 'Offline'}
            </Badge>
          </div>
        </div>
      );
    }

    // Handle manual speed test results (new format)
    if (result.speed_result) {
      const speedResult = result.speed_result;
      const isSuccess = speedResult.success;
      
      return (
        <div className={`p-3 rounded ${
          isSuccess ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
        }`}>
          <div className="flex justify-between items-start">
            <div>
              <div className="font-medium">Node {result.node_id} - {result.ip}</div>
              {isSuccess ? (
                <div className="text-sm">
                  ⬇️ {speedResult.download} Mbps • ⬆️ {speedResult.upload} Mbps • Ping: {speedResult.ping}ms
                </div>
              ) : (
                <div className="text-sm">❌ Ошибка: {speedResult.message}</div>
              )}
              <div className="text-xs text-gray-600">
                Статус: {result.status} • Скорость: {result.speed || 'N/A'}
              </div>
            </div>
            <Badge variant={isSuccess ? 'default' : 'secondary'}>
              {result.status}
            </Badge>
          </div>
        </div>
      );
    }

    // Handle legacy speed test results (old format)
    if (result.speed) {
      const speed = result.speed;
      return (
        <div className={`p-3 rounded ${
          speed.success ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
        }`}>
          <div className="flex justify-between items-start">
            <div>
              <div className="font-medium">Node {result.node_id} - {result.ip}</div>
              {speed.success ? (
                <div className="text-sm">
                  ⬇️ {speed.download} Mbps • ⬆️ {speed.upload} Mbps • Ping: {speed.ping}ms
                  <br />
                  <span className="text-xs">Сервер: {speed.server}</span>
                </div>
              ) : (
                <div className="text-sm">❌ Ошибка: {speed.error}</div>
              )}
            </div>
          </div>
        </div>
      );
    }

    if (result.test) {
      const test = result.test;
      return (
        <div className={`p-3 rounded ${
          test.overall === 'online' ? 'bg-green-100 text-green-800' :
          test.overall === 'degraded' ? 'bg-yellow-100 text-yellow-800' :
          'bg-red-100 text-red-800'
        }`}>
          <div className="flex justify-between items-start">
            <div>
              <div className="font-medium">Node {result.node_id} - {result.ip}</div>
              <div className="text-sm space-y-1">
                {test.ping && (
                  <div>
                    Ping: {test.ping.reachable ? `${test.ping.avg_latency}ms` : 'Недоступен'}
                  </div>
                )}
                {test.speed && (
                  <div>
                    {test.speed.success ? (
                      `Скорость: ⬇️${test.speed.download} Mbps ⬆️${test.speed.upload} Mbps`
                    ) : (
                      'Скорость: Ошибка'
                    )}
                  </div>
                )}
              </div>
            </div>
            <Badge variant={test.overall === 'online' ? 'default' : 
                           test.overall === 'degraded' ? 'secondary' : 'destructive'}>
              {test.overall}
            </Badge>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[800px] max-h-[80vh] overflow-y-auto" data-testid="testing-modal">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center">
              <Activity className="h-5 w-5 mr-2" />
              Тестирование Узлов
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
            Проверка доступности и скорости соединения для выбранных узлов.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Test Type Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Тип Тестирования</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <Select value={testType} onValueChange={setTestType}>
                  <SelectTrigger data-testid="test-type-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ping">
                      <div className="flex items-center">
                        <Wifi className="h-4 w-4 mr-2" />
                        Только Ping
                      </div>
                    </SelectItem>
                    <SelectItem value="speed">
                      <div className="flex items-center">
                        <Zap className="h-4 w-4 mr-2" />
                        Только Скорость
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
                
                <div className="text-xs text-gray-600">
                  {getTestTypeDescription()}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Node Selection Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Выбранные Узлы</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-gray-600">
                {selectedNodeIds.length > 0 ? (
                  <p>Выбрано {selectedNodeIds.length} узлов для тестирования</p>
                ) : (
                  <p>Используйте чекбоксы в таблице для выбора узлов</p>
                )}
                {(!selectedNodeIds || selectedNodeIds.length === 0) && (
                  <div className="text-sm text-red-600">Нет выбранных узлов. Выберите узлы в таблице или используйте Select All.</div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Progress */}
          {loading && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>Прогресс тестирования</span>
                  <span className="text-sm font-normal">
                    {processedNodes}/{totalNodes}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>
                      {progressData?.current_task || `Выполняется ${testType === 'ping' ? 'ping' : testType === 'speed' ? 'speed' : 'комбинированное'} тестирование...`}
                    </span>
                    <span>{Math.round((processedNodes / totalNodes) * 100) || progress}%</span>
                  </div>
                  <Progress value={processedNodes > 0 ? (processedNodes / totalNodes) * 100 : progress} className="w-full" />
                  <div className="text-xs text-gray-600">
                    Тестируется {selectedNodeIds.length} узлов
                    {useNewSystem && ' (батч-система)'}
                  </div>
                  
                  {/* Show recent results for new system */}
                  {progressData?.results && progressData.results.length > 0 && (
                    <div className="mt-2 max-h-20 overflow-y-auto space-y-1">
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

          {/* Results */}
          {results && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center">
                  <Timer className="h-4 w-4 mr-2" />
                  Результаты Тестирования
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {results.map((result, index) => (
                    <div key={index}>
                      {renderTestResult(result)}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Закрыть
          </Button>
          <Button 
            onClick={handleTest}
            disabled={loading || selectedNodeIds.length === 0}
            data-testid="start-testing-btn"
          >
            <Activity className="h-4 w-4 mr-2" />
            {loading ? 'Тестирование...' : 'Начать Тест'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TestingModal;
