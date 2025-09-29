import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import axios from 'axios';

const AddNodeModal = ({ isOpen, onClose, onNodeAdded, type }) => {
  const { API } = useAuth();
  const [loading, setLoading] = useState(false);
  const [autoTest, setAutoTest] = useState(true);
  const [testType, setTestType] = useState('ping');
  const [formData, setFormData] = useState({
    ip: '',
    login: '',
    password: '',
    provider: '',
    country: '',
    state: '',
    city: '',
    zipcode: '',
    comment: '',
    protocol: type || 'pptp'
  });

  React.useEffect(() => {
    if (isOpen) {
      setFormData({
        ip: '',
        login: '',
        password: '',
        provider: '',
        country: '',
        state: '',
        city: '',
        zipcode: '',
        comment: '',
        protocol: type || 'pptp'
      });
      setAutoTest(true);
      setTestType('ping');
    }
  }, [isOpen, type]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (autoTest) {
        // Use auto-test endpoint
        const response = await axios.post(`${API}/nodes/auto-test?test_type=${testType}`, formData);
        
        const node = response.data.node;
        const testResult = response.data.test_result;
        
        toast.success(`${type?.toUpperCase() || 'PPTP'} узел добавлен и протестирован!`);
        
        // Show test results
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
        // Standard creation without test
        await axios.post(`${API}/nodes`, formData);
        toast.success(`${type?.toUpperCase() || 'PPTP'} узел добавлен успешно!`);
      }
      
      onNodeAdded();
    } catch (error) {
      console.error('Error adding node:', error);
      const errorMsg = error.response?.data?.detail || 'Ошибка добавления узла';
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]" data-testid={`add-${type}-modal`}>
        <DialogHeader>
          <DialogTitle>Add {type?.toUpperCase() || 'PPTP'} Node</DialogTitle>
          <DialogDescription>
            Add a new {type} connection to your node list.
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ip">IP Address *</Label>
              <Input
                id="ip"
                value={formData.ip}
                onChange={(e) => handleChange('ip', e.target.value)}
                placeholder="192.168.1.1"
                required
                data-testid="node-ip-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="protocol">Protocol</Label>
              <Select value={formData.protocol} onValueChange={(value) => handleChange('protocol', value)}>
                <SelectTrigger data-testid="node-protocol-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pptp">PPTP</SelectItem>
                  <SelectItem value="ssh">SSH</SelectItem>
                  <SelectItem value="socks">SOCKS</SelectItem>
                  <SelectItem value="server">SERVER</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="login">Login</Label>
              <Input
                id="login"
                value={formData.login}
                onChange={(e) => handleChange('login', e.target.value)}
                placeholder="username"
                data-testid="node-login-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) => handleChange('password', e.target.value)}
                placeholder="password"
                data-testid="node-password-input"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="provider">Provider</Label>
            <Input
              id="provider"
              value={formData.provider}
              onChange={(e) => handleChange('provider', e.target.value)}
              placeholder="e.g., DigitalOcean, AWS, etc."
              data-testid="node-provider-input"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="country">Country</Label>
              <Input
                id="country"
                value={formData.country}
                onChange={(e) => handleChange('country', e.target.value)}
                placeholder="United States"
                data-testid="node-country-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="state">State</Label>
              <Input
                id="state"
                value={formData.state}
                onChange={(e) => handleChange('state', e.target.value)}
                placeholder="California"
                data-testid="node-state-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={formData.city}
                onChange={(e) => handleChange('city', e.target.value)}
                placeholder="Los Angeles"
                data-testid="node-city-input"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="zipcode">ZIP Code</Label>
              <Input
                id="zipcode"
                value={formData.zipcode}
                onChange={(e) => handleChange('zipcode', e.target.value)}
                placeholder="90210"
                data-testid="node-zip-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="comment">Comment</Label>
              <Input
                id="comment"
                value={formData.comment}
                onChange={(e) => handleChange('comment', e.target.value)}
                placeholder="Optional comment"
                data-testid="node-comment-input"
              />
            </div>
          </div>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button 
            type="submit" 
            onClick={handleSubmit}
            disabled={loading || !formData.ip}
            data-testid="add-node-submit-btn"
          >
            {loading ? 'Adding...' : `Add ${type?.toUpperCase() || 'PPTP'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddNodeModal;
