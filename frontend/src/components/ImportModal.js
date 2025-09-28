import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Upload } from 'lucide-react';
import axios from 'axios';

const ImportModal = ({ isOpen, onClose, onImportComplete }) => {
  const { API } = useAuth();
  const [loading, setLoading] = useState(false);
  const [importData, setImportData] = useState('');
  const [protocol, setProtocol] = useState('pptp');
  const [previewResult, setPreviewResult] = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  React.useEffect(() => {
    if (isOpen) {
      setImportData('');
      setProtocol('pptp');
      setPreviewResult(null);
      setShowPreview(false);
    }
  }, [isOpen]);

  const addSampleText = () => {
    const sampleTexts = {
      pptp: `Ip: 144.229.29.35
Login: admin
Pass: admin
State: California
City: Los Angeles
Zip: 90035

76.178.64.46 admin admin CA
96.234.52.227 admin admin NJ

68.227.241.4 - admin:admin - Arizona/Phoenix 85001 | 2025-09-03 16:05:25
96.42.187.97 - 1:1 - Michigan/Lapeer 48446 | 2025-09-03 09:50:22`,
      ssh: `192.168.1.100 root password123 US
10.0.0.50 admin secret456 CA`,
      socks: `proxy1.example.com:1080:user:pass
proxy2.example.com:1080:user2:pass2`,
      server: `server1.example.com admin password
server2.example.com root secret`
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

  const handlePreview = async () => {
    if (!importData.trim()) {
      toast.error('Please enter or upload data to import');
      return;
    }

    setLoading(true);
    try {
      const response = await axios.post(`${API}/import`, {
        data: importData,
        protocol
      });
      setPreviewResult(response.data);
      setShowPreview(true);
      toast.success('Preview generated successfully');
    } catch (error) {
      console.error('Error generating preview:', error);
      const errorMsg = error.response?.data?.detail || 'Failed to generate preview';
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!previewResult) {
      await handlePreview();
      return;
    }

    setLoading(true);
    try {
      // Import was already done during preview, so we just complete
      toast.success(
        `Import completed! ${previewResult.created} nodes added, ${previewResult.duplicates} duplicates skipped`
      );
      onImportComplete();
    } catch (error) {
      console.error('Error importing:', error);
      toast.error('Failed to complete import');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto" data-testid="import-modal">
        <DialogHeader>
          <DialogTitle>Import Nodes</DialogTitle>
          <DialogDescription>
            Import nodes from text data. Supports multiple formats (A-G) as per TZ requirements.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Protocol Selection */}
          <div className="space-y-2">
            <Label htmlFor="import-protocol">Protocol Type</Label>
            <Select value={protocol} onValueChange={setProtocol}>
              <SelectTrigger data-testid="import-protocol-select">
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

          {/* Import Data */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="import-data">Import Data</Label>
              <div className="flex space-x-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addSampleText}
                  data-testid="add-sample-text-btn"
                >
                  Add Sample Text
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
                      Upload File
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
              placeholder="Paste your node data here or upload a file..."
              rows={12}
              className="font-mono text-sm"
              data-testid="import-data-textarea"
            />
          </div>

          {/* Supported Formats Help */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Supported Import Formats</CardTitle>
            </CardHeader>
            <CardContent className="text-xs space-y-2">
              <div><strong>Format A:</strong> Key-value pairs (Ip: xxx, Login: xxx, Pass: xxx)</div>
              <div><strong>Format B:</strong> Space separated (IP login pass state_code)</div>
              <div><strong>Format C:</strong> Dash/pipe format (IP - login:pass - State/City ZIP | date)</div>
              <div><strong>Format D:</strong> Colon separated (IP:login:pass:country:state:zip)</div>
              <div><strong>Format E/F:</strong> Multi-line with Location: State (City)</div>
              <div><strong>Format G:</strong> Minimal (IP login pass)</div>
            </CardContent>
          </Card>

          {/* Preview Results */}
          {showPreview && previewResult && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Import Preview</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-4 gap-4 text-sm">
                  <div className="text-center">
                    <div className="text-xl font-bold text-green-600">{previewResult.created}</div>
                    <div className="text-xs text-gray-600">Created</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-bold text-yellow-600">{previewResult.duplicates}</div>
                    <div className="text-xs text-gray-600">Duplicates</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-bold text-red-600">{previewResult.errors?.length || 0}</div>
                    <div className="text-xs text-gray-600">Errors</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-bold">{previewResult.total_processed}</div>
                    <div className="text-xs text-gray-600">Total</div>
                  </div>
                </div>
                {previewResult.errors && previewResult.errors.length > 0 && (
                  <div className="mt-4">
                    <h4 className="font-medium text-red-600 mb-2">Errors:</h4>
                    <div className="text-xs text-red-600 space-y-1">
                      {previewResult.errors.slice(0, 5).map((error, idx) => (
                        <div key={idx}>{error}</div>
                      ))}
                      {previewResult.errors.length > 5 && (
                        <div>... and {previewResult.errors.length - 5} more errors</div>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {!showPreview ? (
            <Button 
              onClick={handlePreview}
              disabled={loading || !importData.trim()}
              data-testid="preview-import-btn"
            >
              {loading ? 'Generating Preview...' : 'Preview Import'}
            </Button>
          ) : (
            <Button 
              onClick={handleImport}
              disabled={loading}
              data-testid="confirm-import-btn"
            >
              {loading ? 'Importing...' : 'Confirm Import'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ImportModal;
