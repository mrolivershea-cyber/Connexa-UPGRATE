import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTesting } from '../contexts/TestingContext';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Activity, Zap, Wifi, Timer, Minus, X } from 'lucide-react';
import axios from 'axios';

const TestingModal = ({ isOpen, onClose, selectedNodeIds = [], selectAllMode = false, totalCount = 0, activeFilters = {}, onTestComplete }) => {
  const { API } = useAuth();
  const { getActiveImportSession, updateSession, removeSession, addSession } = useTesting();
  const [loading, setLoading] = useState(false);
  const [testType, setTestType] = useState('ping_light');
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
      // First, check for active import session with delay to ensure provider is ready
      setTimeout(() => {
        const activeImportSession = getActiveImportSession();
        
        if (activeImportSession) {
          console.log('Found active import session:', activeImportSession);
          // Connect to active import testing session
          setSessionId(activeImportSession.sessionId);
          setLoading(true);
          setProgressData(null);
          setResults(null);
          setTestType(activeImportSession.testType);
          setProcessedNodes(0);
          setTotalNodes(activeImportSession.nodeIds.length);
          setUseNewSystem(true);
          setIsMinimized(false);
          
          toast.success(`Подключено к активному тестированию из импорта (${activeImportSession.nodeIds.length} узлов)`);
          return;
        }
        
        // Check for saved progress state from manual testing
        const savedState = localStorage.getItem('testingProgress');
        
        if (savedState) {
          try {
            const state = JSON.parse(savedState);
            const isRecent = (Date.now() - state.timestamp) < 300000; // 5 minutes
            
            if (isRecent && state.sessionId) {
              console.log('Restoring saved testing session:', state.sessionId, 'loading:', state.loading, 'completed:', state.completed);
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
              
              if (state.completed) {
                toast.info('Показаны результаты завершенного тестирования');
              } else if (state.loading) {
                toast.info('Восстановлено активное тестирование');
              } else {
                toast.info('Восстановлена сессия тестирования');
              }
              return;
            } else {
              // Clear old saved state only if it's really old
              console.log('Clearing old testing state');
              localStorage.removeItem('testingProgress');
            }
          } catch (error) {
            console.error('Error parsing saved testing state:', error);
            localStorage.removeItem('testingProgress');
          }
        }
        
        // Reset for new testing only if no active sessions found
        console.log('No active sessions found, resetting to default state');
        setTestType('ping_light');
        setResults(null);
        setProgress(0);
        setIsMinimized(false);
        setProcessedNodes(0);
        const calculatedTotal = selectAllMode ? totalCount : selectedNodeIds.length;
        console.log('📊 Setting totalNodes:', {
          selectAllMode,
          totalCount,
          selectedNodeIdsLength: selectedNodeIds.length,
          calculatedTotal
        });
        setTotalNodes(calculatedTotal);
        setProgressData(null);
        setSessionId(null);
        setUseNewSystem(false);
      }, 100);
    }
  }, [isOpen, selectedNodeIds.length, selectAllMode, totalCount, getActiveImportSession]);

  // Auto-persist testing session to survive page refreshes
  React.useEffect(() => {
    if (!sessionId || !loading) return;
    const persist = () => {
      const savedState = {
        sessionId,
        loading,
        progressData: {
          // Only save essential progress data
          processed: progressData?.processed_items || 0,
          total: progressData?.total_items || 0,
          currentOperation: progressData?.current_task || ''
        },
        testType,
        totalNodes,
        timestamp: Date.now()
        // REMOVED: selectedNodeIds, results, processedNodes - too large for localStorage
      };
      
      try {
        // Check localStorage size before saving
        const stateString = JSON.stringify(savedState);
        if (stateString.length > 100000) { // 100KB limit
          console.warn('Testing state too large for localStorage, saving minimal data');
          const minimalState = {
            sessionId,
            loading,
            totalNodes,
            timestamp: Date.now()
          };
          localStorage.setItem('testingProgress', JSON.stringify(minimalState));
        } else {
          localStorage.setItem('testingProgress', stateString);
        }
      } catch (e) {
        console.warn('Failed to save testing progress to localStorage:', e.message);
        // Continue without localStorage
      }
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
              // Update session status in global state
              updateSession(sessionId, { status: 'completed' });
              
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
              
              // Keep completed results visible for longer before cleanup
              const completedState = {
                sessionId: null,
                testRunning: false,
                testType,
                totalNodes,
                timestamp: Date.now(),
                completed: true
                // REMOVED large objects to prevent localStorage overflow
              };
              try {
                localStorage.setItem('testingProgress', JSON.stringify(completedState));
              } catch (e) {
                console.warn('Failed to save completed state to localStorage:', e.message);
              }
              
              // Remove session after longer delay to show completion
              setTimeout(() => {
                removeSession(sessionId);
                // Clean up after session removal, not immediately
                setTimeout(() => {
                  localStorage.removeItem('testingProgress');
                }, 30000); // Keep for 30 seconds after session removal
              }, 10000);
              
              if (onTestComplete) {
                onTestComplete();
              }
              
              // Проверить наличие failed узлов для retry
              if (testType === 'ping_light') {
                try {
                  const statsResponse = await axios.get(`${API}/stats`, {
                    headers: { Authorization: `Bearer ${token}` }
                  });
                  const failedCount = statsResponse.data.ping_failed || 0;
                  if (failedCount > 0) {
                    setFailedNodeCount(failedCount);
                    setShowRetryPrompt(true);
                  }
                } catch (err) {
                  console.error('Failed to get stats for retry:', err);
                }
              }
            } else if (data.status === 'failed') {
              updateSession(sessionId, { status: 'failed' });
              setTimeout(() => {
                removeSession(sessionId);
                localStorage.removeItem('testingProgress');
              }, 5000);
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

  const [pingConcurrency, setPingConcurrency] = useState(15);   // АГРЕССИВНО увеличено для скорости
  const [speedConcurrency, setSpeedConcurrency] = useState(8);  // АГРЕССИВНО увеличено для скорости
  const [pingTimeouts, setPingTimeouts] = useState('0.5');     // СВЕРХ-БЫСТРЫЙ единственный таймаут
  const [speedSampleKB, setSpeedSampleKB] = useState(16); // Оптимизировано: 16KB быстрее чем 32KB      // МИНИМИЗИРОВАНО для максимальной скорости
  const [speedTimeout, setSpeedTimeout] = useState(2);         // ЭКСТРЕМАЛЬНО быстро
  
  // Retry Failed state
  const [showRetryPrompt, setShowRetryPrompt] = useState(false);
  const [failedNodeCount, setFailedNodeCount] = useState(0);

  // Автоматическое изменение параметров при выборе PING LIGHT (ТЗ требование)
  React.useEffect(() => {
    if (testType === 'ping_light') {
      // PING LIGHT оптимальные параметры согласно ТЗ
      setPingConcurrency(100);      // Увеличенный параллелизм для быстрой проверки портов
      setSpeedConcurrency(0);       // Отключаем Speed тесты (не используется в PING LIGHT)
      setPingTimeouts('2');         // 2s timeout (Fast preset) - 78% success rate
      setSpeedSampleKB(0);          // Не используется при проверке порта
      setSpeedTimeout(0);           // Не используется при проверке порта
      console.log('🚀 PING LIGHT режим: параметры оптимизированы для быстрой проверки портов');
    } else {
      // Возвращаем дефолтные параметры для других режимов
      setPingConcurrency(15);       
      setSpeedConcurrency(8);       
      setPingTimeouts('0.5');       
      setSpeedSampleKB(32);         
      setSpeedTimeout(2);           
      console.log('🔄 Режим изменен: параметры возвращены к стандартным значениям');
    }
  }, [testType]);

  // Retry Failed функция
  const retryFailed = async () => {
    setShowRetryPrompt(false);
    
    try {
      const token = localStorage.getItem('token');
      
      // Получить все failed узлы
      const failedResponse = await axios.get(`${API}/nodes?status=ping_failed&limit=1000`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      const failedIds = failedResponse.data.nodes.map(n => n.id);
      
      if (failedIds.length === 0) {
        alert('Нет failed узлов для retry');
        return;
      }
      
      // Установить увеличенный timeout (5s)
      setPingTimeouts('5');
      
      // Запустить тест с failed узлами
      console.log(`🔄 Retry ${failedIds.length} failed nodes with 5s timeout`);
      
      const requestData = {
        node_ids: failedIds,
        ping_concurrency: 100,
        ping_timeouts: [5.0]
      };
      
      const response = await axios.post(`${API}/manual/ping-light-test-batch-progress`, requestData, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 180000
      });
      
      setSessionId(response.data.session_id);
      setLoading(true);
      setError(null);
      
    } catch (err) {
      console.error('Retry failed:', err);
      setError(err.response?.data?.detail || err.message || 'Retry failed');
    }
  };

  const handleTest = async () => {
    // DEBUG: проверяем что приходит
    console.log('🔍 handleTest called');
    console.log('selectedNodeIds:', selectedNodeIds);
    console.log('selectedNodeIds.length:', selectedNodeIds.length);
    console.log('selectAllMode:', selectAllMode);
    console.log('totalCount (prop):', totalCount);
    console.log('totalNodes (state):', totalNodes);
    console.log('testType:', testType);
    
    if (!selectAllMode && selectedNodeIds.length === 0) {
      console.log('❌ Stopping: no nodes selected');
      toast.error('Выберите узлы для тестирования');
      return;
    }
    
    if (selectAllMode) {
      toast.info('🚀 Запуск тестирования всех узлов в базе...');
    }
    
    console.log('✅ Validation passed, starting test...');

    setLoading(true);
    setProgress(0);
    setProcessedNodes(0);
    setTotalNodes(selectAllMode ? totalCount : selectedNodeIds.length);
    setResults(null);
    setProgressData(null);
    setSessionId(null);
    
    // ALWAYS use progress-enabled endpoints for ANY batch size
    setUseNewSystem(true);
    
    try {
      let endpoint;
      
      // Use appropriate endpoints for each test type
      if (testType === 'ping_light') {
        endpoint = 'manual/ping-light-test-batch-progress';  // Fast TCP check without auth with progress
      } else if (testType === 'ping') {
        endpoint = 'manual/ping-test-batch-progress';  // Full ping with auth
      } else if (testType === 'speed') {
        endpoint = 'manual/speed-test-batch-progress';
      }
      
      // No more progress simulation - SSE will provide real progress
      
      const nodeCount = selectAllMode ? totalCount : selectedNodeIds.length;
      console.log(`Starting ${testType} test for ${nodeCount} nodes using ${endpoint}`);
      
      // Для selectAllMode НЕ передаём node_ids - backend сам получит узлы по фильтрам
      const requestData = {
        test_type: testType,
        ping_concurrency: pingConcurrency,
        speed_concurrency: speedConcurrency,
        ping_timeouts: pingTimeouts.split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v)),
        speed_sample_kb: Number(speedSampleKB) || 512,
        speed_timeout: Number(speedTimeout) || 15
      };
      
      // Только для режима выбора отдельных узлов передаём node_ids
      if (!selectAllMode) {
        requestData.node_ids = selectedNodeIds;
      } else {
        // Передаём фильтры для Select All режима
        requestData.filters = activeFilters;
      }
      
      const response = await axios.post(`${API}/${endpoint}`, requestData, {
        timeout: 180000 // 3 minutes for single tests
      });
      
      if (response.data.session_id) {
        // Track progress via SSE
        setSessionId(response.data.session_id);
        
        // Register session in global state
        addSession(response.data.session_id, 'manual', selectedNodeIds, testType);
        
        // Persist initial state to survive refreshes
        const savedState = {
          sessionId: response.data.session_id,
          loading: true,
          testType,
          totalNodes: selectedNodeIds.length,
          timestamp: Date.now()
          // REMOVED large arrays to prevent localStorage overflow
        };
        try {
          localStorage.setItem('testingProgress', JSON.stringify(savedState));
        } catch (e) {
          console.warn('Failed to save test start state to localStorage:', e.message);
        }
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
        testRunning: true,
        testType,
        totalNodes,
        timestamp: Date.now()
        // REMOVED large objects to prevent localStorage overflow
      };
      try {
        localStorage.setItem('testingProgress', JSON.stringify(savedState));
        toast.info('Тестирование свернуто. Откройте Testing для просмотра прогресса.');
      } catch (e) {
        console.warn('Failed to save minimized state to localStorage:', e.message);
        toast.info('Тестирование продолжается в фоне.');
      }
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
              {sessionId && progressData && (
                <Badge variant="secondary" className="ml-2">
                  {getActiveImportSession()?.sessionId === sessionId ? 'Из импорта' : 'Ручное'}
                </Badge>
              )}
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
                    <SelectItem value="ping_light">
                      <div className="flex items-center">
                        <Zap className="h-4 w-4 mr-2 text-yellow-500" />
                        PING LIGHT (быстро)
                      </div>
                    </SelectItem>
                    <SelectItem value="ping">
                      <div className="flex items-center">
                        <Wifi className="h-4 w-4 mr-2" />
                        PING OK (с авторизацией)
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
          {/* Concurrency & Tuning */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Параметры Производительности</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Параллелизм (Ping)</label>
                  <input type="number" min={1} max={50} value={pingConcurrency} onChange={e => setPingConcurrency(parseInt(e.target.value) || 15)} className="w-full border rounded px-2 py-1" />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Параллелизм (Speed)</label>
                  <input type="number" min={1} max={20} value={speedConcurrency} onChange={e => setSpeedConcurrency(parseInt(e.target.value) || 8)} className="w-full border rounded px-2 py-1" />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Таймауты Ping (сек, через запятую)</label>
                  {testType === 'ping_light' && (
                    <div className="flex gap-2 mb-2">
                      <button onClick={() => setPingTimeouts('2')} className={`px-2 py-1 text-xs rounded ${pingTimeouts === '2' ? 'bg-green-500 text-white' : 'bg-gray-100'}`}>
                        ⚡ Fast (2s) ~78%
                      </button>
                      <button onClick={() => setPingTimeouts('3')} className={`px-2 py-1 text-xs rounded ${pingTimeouts === '3' ? 'bg-green-500 text-white' : 'bg-gray-100'}`}>
                        ⚖️ Balanced (3s) ~82%
                      </button>
                      <button onClick={() => setPingTimeouts('5')} className={`px-2 py-1 text-xs rounded ${pingTimeouts === '5' ? 'bg-green-500 text-white' : 'bg-gray-100'}`}>
                        🎯 Thorough (5s) ~88%
                      </button>
                    </div>
                  )}
                  <input type="text" value={pingTimeouts} onChange={e => setPingTimeouts(e.target.value)} className="w-full border rounded px-2 py-1" />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Объём пробы Speed (KB)</label>
                  <div className="flex gap-2 mb-2">
                    <button onClick={() => setSpeedSampleKB(8)} className={`px-2 py-1 text-xs rounded ${speedSampleKB === 8 ? 'bg-blue-500 text-white' : 'bg-gray-100'}`}>
                      ⚡ Fast (8KB)
                    </button>
                    <button onClick={() => setSpeedSampleKB(16)} className={`px-2 py-1 text-xs rounded ${speedSampleKB === 16 ? 'bg-blue-500 text-white' : 'bg-gray-100'}`}>
                      ⚖️ Balanced (16KB)
                    </button>
                    <button onClick={() => setSpeedSampleKB(32)} className={`px-2 py-1 text-xs rounded ${speedSampleKB === 32 ? 'bg-blue-500 text-white' : 'bg-gray-100'}`}>
                      🎯 Thorough (32KB)
                    </button>
                  </div>
                  <input type="number" min={8} max={256} value={speedSampleKB} onChange={e => setSpeedSampleKB(parseInt(e.target.value) || 16)} className="w-full border rounded px-2 py-1" />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Таймаут Speed (сек)</label>
                  <input type="number" min={1} max={10} value={speedTimeout} onChange={e => setSpeedTimeout(parseInt(e.target.value) || 2)} className="w-full border rounded px-2 py-1" />
                </div>
              </div>
              <div className="text-xs text-gray-500 mt-2">По умолчанию: Ping=15, Speed=8, Ping таймаут=0.5с, Speed=32KB, 2с (ЭКСТРЕМАЛЬНО оптимизировано для максимальной скорости)</div>
            </CardContent>
          </Card>

            </CardContent>
          </Card>

          {/* Node Selection Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Выбранные Узлы</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-gray-600">
                {(selectAllMode || selectedNodeIds.length > 0) ? (
                  <p>Выбрано {selectAllMode ? `ВСЕ узлы базы (${totalCount} total)` : `${selectedNodeIds.length} узлов`} для тестирования</p>
                ) : (
                  <p>Используйте чекбоксы в таблице для выбора узлов</p>
                )}
                {!selectAllMode && (!selectedNodeIds || selectedNodeIds.length === 0) && (
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
                      {progressData?.current_task || `Выполняется ${
                        testType === 'ping_light' ? 'PING LIGHT (быстрая проверка TCP порта)' :
                        testType === 'ping' ? 'PING OK (с авторизацией)' : 
                        testType === 'speed' ? 'тест скорости' : 
                        'комбинированное'
                      } тестирование...`}
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
            disabled={loading || (!selectAllMode && selectedNodeIds.length === 0)}
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
