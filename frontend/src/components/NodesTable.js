import React, { useState, Fragment } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { 
  MoreHorizontal,
  Eye,
  EyeOff,
  Copy,
  Trash2,
  Edit,
  Check,
  X,
  Activity,
  Play,
  Square,
  Download
} from 'lucide-react';
import axios from 'axios';

const NodesTable = ({ nodes, selectedNodes, onSelectNode, onNodeUpdated, loading }) => {
  const { API } = useAuth();
  const [editingNode, setEditingNode] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [showPasswords, setShowPasswords] = useState({});

  const handleSelectAll = () => {
    if (selectedNodes.length === nodes.length && nodes.length > 0) {
      // Deselect all
      nodes.forEach(node => onSelectNode(node.id));
    } else {
      // Select all that are not already selected
      nodes.forEach(node => {
        if (!selectedNodes.includes(node.id)) {
          onSelectNode(node.id);
        }
      });
    }
  };

  const getStatusBadge = (status) => {
    const statusConfig = {
      online: { emoji: '🟢', class: 'bg-green-100 text-green-800', label: 'Online' },
      offline: { emoji: '🔴', class: 'bg-red-100 text-red-800', label: 'Offline' },
      checking: { emoji: '🟡', class: 'bg-yellow-100 text-yellow-800', label: 'Checking' },
      degraded: { emoji: '🟠', class: 'bg-orange-100 text-orange-800', label: 'Degraded' },
      needs_review: { emoji: '⚪', class: 'bg-gray-100 text-gray-800', label: 'Needs Review' },
      reconnecting: { emoji: '🔁', class: 'bg-blue-100 text-blue-800', label: 'Reconnecting' }
    };
    
    const config = statusConfig[status] || statusConfig.offline;
    
    return (
      <Badge className={config.class} title={config.label}>
        {config.emoji}
      </Badge>
    );
  };

  const getPingStatusBadge = (pingStatus) => {
    const pingConfig = {
      ping_success: { emoji: '🔵', class: 'bg-blue-100 text-blue-800', label: 'Ping Success' },
      ping_failed: { emoji: '🟣', class: 'bg-purple-100 text-purple-800', label: 'Ping Failed' },
      not_tested: { emoji: '⚫', class: 'bg-gray-100 text-gray-600', label: 'Not Tested' }
    };
    
    if (!pingStatus) return null;
    
    const config = pingConfig[pingStatus] || pingConfig.not_tested;
    
    return (
      <Badge className={`${config.class} ml-1`} title={config.label}>
        {config.emoji}
      </Badge>
    );
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffMins < 60) {
      return `${diffMins}m ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else {
      return `${diffDays}d ago`;
    }
  };

  const testNode = async (nodeId, testType = 'ping') => {
    try {
      const response = await axios.post(`${API}/nodes/${nodeId}/test?test_type=${testType}`);
      if (response.data.success) {
        toast.success(`Test ${testType} completed for node ${nodeId}`);
        onNodeUpdated();
      } else {
        toast.error(`Test failed: ${response.data.message}`);
      }
    } catch (error) {
      console.error('Test error:', error);
      toast.error('Test failed: ' + (error.response?.data?.detail || error.message));
    }
  };

  const startServices = async (nodeId) => {
    try {
      const response = await axios.post(`${API}/nodes/${nodeId}/services/start`);
      if (response.data.success) {
        toast.success(response.data.message);
        onNodeUpdated();
      } else {
        toast.error(`Start failed: ${response.data.message}`);
      }
    } catch (error) {
      console.error('Start services error:', error);
      toast.error('Start failed: ' + (error.response?.data?.detail || error.message));
    }
  };

  const stopServices = async (nodeId) => {
    try {
      const response = await axios.post(`${API}/nodes/${nodeId}/services/stop`);
      if (response.data.success) {
        toast.success(response.data.message);
        onNodeUpdated();
      } else {
        toast.error(`Stop failed: ${response.data.message}`);
      }
    } catch (error) {
      console.error('Stop services error:', error);
      toast.error('Stop failed: ' + (error.response?.data?.detail || error.message));
    }
  };

  const togglePasswordVisibility = (nodeId) => {
    setShowPasswords(prev => ({
      ...prev,
      [nodeId]: !prev[nodeId]
    }));
  };

  const copyToClipboard = async (text, type = 'text') => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${type} copied to clipboard!`);
    } catch (error) {
      console.error('Copy failed:', error);
      toast.error('Failed to copy to clipboard');
    }
  };

  const copySocks = (node) => {
    const socksFormat = `${node.ip}:1080:${node.login}:${node.password}`;
    copyToClipboard(socksFormat, 'SOCKS config');
  };

  const copyCredentials = (node) => {
    const credentialsFormat = `${node.ip}:${node.login}:${node.password}`;
    copyToClipboard(credentialsFormat, 'Credentials');
  };

  const startEdit = (node, field) => {
    setEditingNode(`${node.id}-${field}`);
    setEditValues({
      ...editValues,
      [`${node.id}-${field}`]: node[field] || ''
    });
  };

  const cancelEdit = () => {
    setEditingNode(null);
    setEditValues({});
  };

  const saveEdit = async (node, field) => {
    const newValue = editValues[`${node.id}-${field}`] || '';
    
    try {
      await axios.put(`${API}/nodes/${node.id}`, {
        [field]: newValue
      });
      toast.success(`${field} updated successfully`);
      onNodeUpdated();
      setEditingNode(null);
    } catch (error) {
      console.error('Error updating node:', error);
      toast.error(`Failed to update ${field}`);
    }
  };

  const deleteNode = async (nodeId) => {
    if (!window.confirm('Are you sure you want to delete this node?')) {
      return;
    }

    try {
      await axios.delete(`${API}/nodes/${nodeId}`);
      toast.success('Node deleted successfully');
      onNodeUpdated();
    } catch (error) {
      console.error('Error deleting node:', error);
      toast.error('Failed to delete node');
    }
  };

  const EditableCell = ({ node, field, className = '' }) => {
    const isEditing = editingNode === `${node.id}-${field}`;
    const value = node[field] || '';

    if (isEditing) {
      return (
        <div className={`flex items-center space-x-2 ${className}`}>
          <Input
            value={editValues[`${node.id}-${field}`] || ''}
            onChange={(e) => setEditValues({
              ...editValues,
              [`${node.id}-${field}`]: e.target.value
            })}
            className="text-xs h-8"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                saveEdit(node, field);
              } else if (e.key === 'Escape') {
                cancelEdit();
              }
            }}
          />
          <Button size="sm" variant="ghost" onClick={() => saveEdit(node, field)}>
            <Check className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="ghost" onClick={cancelEdit}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      );
    }

    return (
      <div 
        className={`cursor-pointer hover:bg-gray-100 p-1 rounded ${className}`}
        onClick={() => startEdit(node, field)}
        title={`Click to edit ${field}`}
      >
        {value || <span className="text-gray-400 italic">Empty</span>}
      </div>
    );
  };

  if (loading && nodes.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <div className="text-lg font-medium">Loading nodes...</div>
        </CardContent>
      </Card>
    );
  }

  if (nodes.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <div className="text-lg font-medium mb-2">No nodes found</div>
          <p className="text-gray-600">Add some nodes to get started or adjust your filters.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full" data-testid="nodes-table">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <Checkbox 
                  checked={selectedNodes.length === nodes.length && nodes.length > 0}
                  onCheckedChange={handleSelectAll}
                  data-testid="select-all-nodes-checkbox"
                />
              </th>
              <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Speed
              </th>
              <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                IP
              </th>
              <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Protocol
              </th>
              <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Login
              </th>
              <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Password
              </th>
              <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                SOCKS
              </th>
              <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                OVPN
              </th>
              <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
              <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Comment
              </th>
            </tr>
          </thead>
          <tbody className="bg-white">
            {nodes.map((node, index) => (
              <Fragment key={node.id}>
                {/* First Row: Main Information */}
                <tr className={`${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50 border-b border-gray-100`} data-testid={`node-row-${node.id}`}>
                  <td className="px-2 py-2 whitespace-nowrap" rowSpan={2}>
                    <Checkbox 
                      checked={selectedNodes.includes(node.id)}
                      onCheckedChange={() => onSelectNode(node.id)}
                      data-testid={`node-checkbox-${node.id}`}
                    />
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    <div className="flex items-center">
                      {getStatusBadge(node.status)}
                      {getPingStatusBadge(node.ping_status)}
                    </div>
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-sm text-gray-900">
                    {node.speed ? `${node.speed} Mbps` : '-'}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-sm font-medium text-gray-900">
                    {node.ip}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-sm text-gray-900">
                    <Badge variant="outline">{node.protocol?.toUpperCase() || 'PPTP'}</Badge>
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-sm text-gray-900">
                    {node.login}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-sm text-gray-900">
                    <div className="flex items-center space-x-1">
                      <span className="text-xs">
                        {showPasswords[node.id] ? node.password : '••••••••'}
                      </span>
                      <Button 
                        size="sm" 
                        variant="ghost" 
                        onClick={() => togglePasswordVisibility(node.id)}
                        data-testid={`toggle-password-${node.id}`}
                        className="h-6 w-6 p-0"
                      >
                        {showPasswords[node.id] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      </Button>
                      <Button 
                        size="sm" 
                        variant="ghost" 
                        onClick={() => copyCredentials(node)}
                        data-testid={`copy-credentials-${node.id}`}
                        className="h-6 w-6 p-0"
                        title="Copy IP:Login:Password"
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-sm text-gray-900">
                    <Button 
                      size="sm" 
                      variant="outline" 
                      onClick={() => copySocks(node)}
                      data-testid={`copy-socks-${node.id}`}
                      className="text-xs px-2 py-1"
                    >
                      <Copy className="h-3 w-3 mr-1" />
                      Copy
                    </Button>
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-right text-sm font-medium">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" data-testid={`node-actions-${node.id}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => copyToClipboard(node.ip, 'IP Address')}>
                          <Copy className="h-4 w-4 mr-2" />
                          Copy IP
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => copySocks(node)}>
                          <Copy className="h-4 w-4 mr-2" />
                          Copy SOCKS
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => testNode(node.id, 'ping')}>
                          <Activity className="h-4 w-4 mr-2" />
                          Test Ping
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => startServices(node.id)}>
                          <Play className="h-4 w-4 mr-2" />
                          Start Services
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => stopServices(node.id)}>
                          <Square className="h-4 w-4 mr-2" />
                          Stop Services
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => deleteNode(node.id)}
                          className="text-red-600"
                          data-testid={`delete-node-${node.id}`}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-sm text-gray-900 max-w-xs">
                    <EditableCell node={node} field="comment" className="max-w-xs truncate" />
                  </td>
                </tr>

                {/* Second Row: Location and Date Information */}
                <tr className={`${index % 2 === 0 ? 'bg-gray-25' : 'bg-gray-75'} text-xs text-gray-600 border-b-2 border-gray-200`}>
                  <td className="px-2 py-1 text-xs text-gray-500">
                    {formatDate(node.last_update)}
                  </td>
                  <td className="px-2 py-1">
                    <EditableCell node={node} field="country" />
                  </td>
                  <td className="px-2 py-1">
                    <EditableCell node={node} field="state" />
                  </td>
                  <td className="px-2 py-1">
                    <EditableCell node={node} field="city" />
                  </td>
                  <td className="px-2 py-1">
                    <EditableCell node={node} field="zipcode" />
                  </td>
                  <td className="px-2 py-1" colSpan={2}>
                    <EditableCell node={node} field="provider" />
                  </td>
                  <td colSpan={3}></td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default NodesTable;
