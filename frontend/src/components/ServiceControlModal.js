import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Play, Square, Zap, Activity } from 'lucide-react';
import axios from 'axios';

const ServiceControlModal = ({ isOpen, onClose }) => {
  const { API } = useAuth();
  const [loading, setLoading] = useState(false);
  const [selectedNodes, setSelectedNodes] = useState([]);
  const [action, setAction] = useState('start');
  const [results, setResults] = useState(null);

  React.useEffect(() => {
    if (isOpen) {
      setSelectedNodes([]);
      setAction('start');
      setResults(null);
      loadNodes();
    }
  }, [isOpen]);

  const loadNodes = async () => {
    try {
      const response = await axios.get(`${API}/nodes`);
      // You can set available nodes here if needed
    } catch (error) {
      console.error('Error loading nodes:', error);
    }
  };

  const handleServiceAction = async () => {
    if (selectedNodes.length === 0) {
      toast.error('Выберите узлы для управления сервисами');
      return;
    }

    setLoading(true);
    try {
      const endpoint = action === 'start' ? 'services/start' : 'services/stop';
      const response = await axios.post(`${API}/${endpoint}`, {
        node_ids: selectedNodes,
        action: action
      });

      setResults(response.data.results);
      
      const successCount = response.data.results.filter(r => r.success).length;
      const failCount = response.data.results.length - successCount;
      
      if (successCount > 0) {
        toast.success(`${action === 'start' ? 'Запущено' : 'Остановлено'} ${successCount} сервисов`);
      }
      if (failCount > 0) {
        toast.error(`Ошибка с ${failCount} сервисами`);
      }
      
    } catch (error) {
      console.error('Service action error:', error);
      toast.error('Ошибка управления сервисами: ' + (error.response?.data?.detail || error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleNodeSelection = (nodeIds) => {
    setSelectedNodes(nodeIds);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[700px] max-h-[80vh] overflow-y-auto" data-testid="service-control-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center">
            <Zap className="h-5 w-5 mr-2" />
            Управление Сервисами
          </DialogTitle>
          <DialogDescription>
            Управление PPTP подключениями и SOCKS серверами для выбранных узлов.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Action Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Действие</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex space-x-4">
                <Button
                  variant={action === 'start' ? 'default' : 'outline'}
                  onClick={() => setAction('start')}
                  data-testid="start-services-btn"
                >
                  <Play className="h-4 w-4 mr-2" />
                  Запустить Сервисы
                </Button>
                <Button
                  variant={action === 'stop' ? 'default' : 'outline'}
                  onClick={() => setAction('stop')}
                  data-testid="stop-services-btn"
                >
                  <Square className="h-4 w-4 mr-2" />
                  Остановить Сервисы
                </Button>
              </div>
              
              <Alert className="mt-4">
                <AlertDescription>
                  {action === 'start' ? (
                    <div>
                      <strong>Запуск сервисов:</strong>
                      <ul className="list-disc list-inside mt-2 text-sm">
                        <li>Установка PPTP подключения к узлу</li>
                        <li>Запуск SOCKS сервера на PPTP интерфейсе</li>
                        <li>Автоматическое назначение портов</li>
                      </ul>
                    </div>
                  ) : (
                    <div>
                      <strong>Остановка сервисов:</strong>
                      <ul className="list-disc list-inside mt-2 text-sm">
                        <li>Остановка SOCKS серверов</li>
                        <li>Разрыв PPTP подключений</li>
                        <li>Очистка конфигурационных файлов</li>
                      </ul>
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          {/* Node Selection Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Выбранные Узлы</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-gray-600">
                {selectedNodes.length > 0 ? (
                  <p>Выбрано {selectedNodes.length} узлов</p>
                ) : (
                  <p>Используйте чекбоксы в таблице для выбора узлов</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Results */}
          {results && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Результаты</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {results.map((result, index) => (
                    <div key={index} className={`p-2 rounded text-sm ${
                      result.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                      <div className="font-medium">Node {result.node_id}</div>
                      <div>{result.message}</div>
                      {result.socks && (
                        <div className="text-xs mt-1">
                          SOCKS: {result.socks.ip}:{result.socks.port}
                        </div>
                      )}
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
            onClick={handleServiceAction}
            disabled={loading || selectedNodes.length === 0}
            data-testid="execute-service-action-btn"
          >
            <Zap className="h-4 w-4 mr-2" />
            {loading ? 'Выполняется...' : (action === 'start' ? 'Запустить' : 'Остановить')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ServiceControlModal;