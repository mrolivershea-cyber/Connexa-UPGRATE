import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Settings, Lock, Bell } from 'lucide-react';

const OptionsModal = ({ isOpen, onClose }) => {
  const { changePassword } = useAuth();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('password');
  
  // Password change state
  const [passwordForm, setPasswordForm] = useState({
    oldPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [passwordError, setPasswordError] = useState('');

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setPasswordError('');

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('New password and confirmation do not match');
      setLoading(false);
      return;
    }

    if (passwordForm.newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters long');
      setLoading(false);
      return;
    }

    const result = await changePassword(
      passwordForm.oldPassword, 
      passwordForm.newPassword, 
      passwordForm.confirmPassword
    );
    
    if (result.success) {
      toast.success('Password changed successfully!');
      setPasswordForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
    } else {
      setPasswordError(result.error);
      toast.error('Password change failed: ' + result.error);
    }
    
    setLoading(false);
  };

  const handlePasswordChange = (field, value) => {
    setPasswordForm(prev => ({ ...prev, [field]: value }));
    setPasswordError('');
  };

  React.useEffect(() => {
    if (isOpen) {
      setPasswordForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
      setPasswordError('');
      setActiveTab('password');
    }
  }, [isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]" data-testid="options-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center">
            <Settings className="h-5 w-5 mr-2" />
            Admin Panel Options
          </DialogTitle>
          <DialogDescription>
            Manage your admin panel settings and preferences.
          </DialogDescription>
        </DialogHeader>
        
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="password" data-testid="password-tab">
              <Lock className="h-4 w-4 mr-2" />
              Security
            </TabsTrigger>
            <TabsTrigger value="system" data-testid="system-tab">
              <Settings className="h-4 w-4 mr-2" />
              System
            </TabsTrigger>
            <TabsTrigger value="notifications" data-testid="notifications-tab">
              <Bell className="h-4 w-4 mr-2" />
              Notifications
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="password" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Change Password</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handlePasswordSubmit} className="space-y-4">
                  {passwordError && (
                    <Alert variant="destructive">
                      <AlertDescription>{passwordError}</AlertDescription>
                    </Alert>
                  )}
                  
                  <div className="space-y-2">
                    <Label htmlFor="old-password-modal">Current Password</Label>
                    <Input
                      id="old-password-modal"
                      type="password"
                      value={passwordForm.oldPassword}
                      onChange={(e) => handlePasswordChange('oldPassword', e.target.value)}
                      required
                      disabled={loading}
                      data-testid="old-password-input"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="new-password-modal">New Password</Label>
                    <Input
                      id="new-password-modal"
                      type="password"
                      value={passwordForm.newPassword}
                      onChange={(e) => handlePasswordChange('newPassword', e.target.value)}
                      required
                      minLength={6}
                      disabled={loading}
                      data-testid="new-password-input"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="confirm-password-modal">Confirm New Password</Label>
                    <Input
                      id="confirm-password-modal"
                      type="password"
                      value={passwordForm.confirmPassword}
                      onChange={(e) => handlePasswordChange('confirmPassword', e.target.value)}
                      required
                      minLength={6}
                      disabled={loading}
                      data-testid="confirm-password-input"
                    />
                  </div>
                  
                  <Button 
                    type="submit" 
                    disabled={loading}
                    data-testid="change-password-modal-btn"
                  >
                    {loading ? 'Changing Password...' : 'Change Password'}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="system" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Геолокация (IP → City/State/ZIP)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <input type="checkbox" id="geo-ipapi" defaultChecked />
                    <Label htmlFor="geo-ipapi" className="font-semibold">ip-api.com (Бесплатно)</Label>
                  </div>
                  <p className="text-xs text-gray-500 ml-6">
                    45 запросов/мин, не требует API ключ
                  </p>
                  
                  <div className="flex items-center space-x-2 mt-4">
                    <input type="checkbox" id="geo-ipinfo" />
                    <Label htmlFor="geo-ipinfo">ipinfo.io</Label>
                  </div>
                  <Input
                    placeholder="API ключ ipinfo.io"
                    className="ml-6 text-sm"
                    disabled
                  />
                  
                  <div className="flex items-center space-x-2 mt-4">
                    <input type="checkbox" id="geo-maxmind" />
                    <Label htmlFor="geo-maxmind">MaxMind GeoIP2</Label>
                  </div>
                  <Input
                    placeholder="License Key MaxMind"
                    className="ml-6 text-sm"
                    disabled
                  />
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Fraud Detection (Scamalytics)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <input type="checkbox" id="fraud-ipqs" defaultChecked />
                    <Label htmlFor="fraud-ipqs" className="font-semibold">IPQualityScore (Активен)</Label>
                  </div>
                  <div className="space-y-2 ml-6">
                    <Label htmlFor="ipqs-api-key" className="text-sm">API Key</Label>
                    <Input
                      id="ipqs-api-key"
                      type="text"
                      placeholder="Введите API ключ"
                      defaultValue="uMGBBCbfRXOHbojCTJBloiA6tIIqJcFj"
                      className="text-sm"
                      data-testid="ipqs-api-key"
                    />
                  </div>
                  
                  <div className="flex items-center space-x-2 mt-4">
                    <input type="checkbox" id="fraud-scamalytics" />
                    <Label htmlFor="fraud-scamalytics">Scamalytics.com</Label>
                  </div>
                  <Input
                    placeholder="API ключ Scamalytics"
                    className="ml-6 text-sm"
                    disabled
                  />
                  
                  <div className="flex items-center space-x-2 mt-4">
                    <input type="checkbox" id="fraud-abuseipdb" />
                    <Label htmlFor="fraud-abuseipdb">AbuseIPDB.com</Label>
                  </div>
                  <Input
                    placeholder="API ключ AbuseIPDB"
                    className="ml-6 text-sm"
                    disabled
                  />
                </div>
                
                <Button 
                  onClick={async () => {
                    const key = document.getElementById('ipqs-api-key').value;
                    try {
                      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/settings`, {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'Authorization': `Bearer ${localStorage.getItem('token')}`
                        },
                        body: JSON.stringify({ ipqs_api_key: key })
                      });
                      if (response.ok) {
                        toast.success('API ключ сохранён');
                      } else {
                        toast.error('Ошибка сохранения');
                      }
                    } catch (error) {
                      toast.error('Ошибка: ' + error.message);
                    }
                  }}
                >
                  Сохранить настройки
                </Button>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>System Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-sm text-gray-600">
                  <strong>Version:</strong> Connexa v1.7
                </div>
                <div className="text-sm text-gray-600">
                  <strong>Database:</strong> SQLite
                </div>
                <div className="text-sm text-gray-600">
                  <strong>Backend:</strong> FastAPI
                </div>
                <div className="text-sm text-gray-600">
                  <strong>Frontend:</strong> React + ShadCN UI
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="notifications" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Notification Settings</CardTitle>
              </CardHeader>
              <CardContent>
                <Alert>
                  <AlertDescription>
                    Notification settings (Telegram integration, email alerts, etc.) 
                    will be available in future versions. Currently, all notifications 
                    are displayed as browser toasts.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default OptionsModal;
