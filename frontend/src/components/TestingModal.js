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

  React.useEffect(() => {
    if (isOpen) {
      setTestType('ping');
      setResults(null);
      setProgress(0);
      setIsMinimized(false);
      setProcessedNodes(0);
      setTotalNodes(selectedNodeIds.length);
    }
  }, [isOpen, selectedNodeIds.length]);

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
    
    // Declare progressInterval in the function scope so it's accessible in catch/finally blocks
    let progressInterval = null;
    
    try {
      // Use batch endpoint for multiple nodes, single endpoint for one node
      let endpoint = selectedNodeIds.length > 1 ? 'manual/ping-test-batch' : 'manual/ping-test';
      if (testType === 'speed') endpoint = 'manual/speed-test';
      if (testType === 'both') endpoint = selectedNodeIds.length > 1 ? 'manual/ping-speed-test-batch' : 'manual/ping-test';
      
      // Improved progress simulation based on node count and test type
      let expectedDuration;
      if (selectedNodeIds.length > 1) {
        // Batch operations
        if (testType === 'both') {
          expectedDuration = Math.min(selectedNodeIds.length * 8000, 150000); // Combined: ~8s per node, max 150s
        } else {
          expectedDuration = Math.min(selectedNodeIds.length * 3000, 90000); // Regular batch: ~3s per node, max 90s
        }
      } else {
        // Single node operations
        expectedDuration = testType === 'both' ? 25000 : 15000; // Single: 25s for combined, 15s for single test
      }
      const progressStep = 90 / (expectedDuration / 1000); // Reach 90% by expected time
      
      progressInterval = setInterval(() => {
        setProgress(prev => prev < 90 ? prev + progressStep : prev);
      }, 1000);
      
      console.log(`Starting ${testType} test for ${selectedNodeIds.length} nodes using ${endpoint}`);
      
      const response = await axios.post(`${API}/${endpoint}`, {
        node_ids: selectedNodeIds,
        test_type: testType
      }, {
        timeout: testType === 'both' ? 300000 : 180000 // 5 minutes for combined, 3 minutes for single tests
      });
      
      // Clear interval and set progress to 100% on success
      if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
      }
      setProgress(100);
      
      setResults(response.data.results);
      setProcessedNodes(response.data.results.length);
      
      const successCount = response.data.results.filter(r => r.success).length;
      const failCount = response.data.results.length - successCount;
      
      if (successCount > 0) {
        toast.success(`Протестировано ${successCount} узлов`);
      }
      if (failCount > 0) {
        toast.warning(`Ошибки с ${failCount} узлами`);
      }

      if (onTestComplete) {
        onTestComplete();
      }
      
    } catch (error) {
      console.error('Testing error:', error);
      toast.error('Ошибка тестирования: ' + (error.response?.data?.detail || error.message));
    } finally {
      // Always clear the interval and reset loading state
      if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
      }
      setProgress(100);
      setLoading(false);
    }
  };

  const handleMinimize = () => {
    setIsMinimized(true);
  };

  const handleRestore = () => {
    setIsMinimized(false);
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
            {loading && (
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
                    <SelectItem value="both">
                      <div className="flex items-center">
                        <Activity className="h-4 w-4 mr-2" />
                        Ping + Скорость
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
                    <span>Выполняется {testType === 'ping' ? 'ping' : testType === 'speed' ? 'speed' : 'комбинированное'} тестирование...</span>
                    <span>{Math.round((processedNodes / totalNodes) * 100) || progress}%</span>
                  </div>
                  <Progress value={processedNodes > 0 ? (processedNodes / totalNodes) * 100 : progress} className="w-full" />
                  <div className="text-xs text-gray-600">
                    Тестируется {selectedNodeIds.length} узлов
                  </div>
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