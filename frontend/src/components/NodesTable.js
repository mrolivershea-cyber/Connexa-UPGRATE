import React, { useState } from 'react';
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
  Square
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
      <Badge className={config.class}>
        <span className="mr-1">{config.emoji}</span>
        {config.label}
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

  const testNode = async (nodeId, testType) => {
    try {
      toast.info(`Testing ${testType} for node...`);
      const response = await axios.post(`${API}/nodes/${nodeId}/test`, {
        test_type: testType
      });
      
      if (response.data.success) {
        toast.success(`${testType} test successful`);
      } else {
        toast.error(`${testType} test failed: ${response.data.message}`);
      }
      onNodeUpdated();
    } catch (error) {
      console.error('Error testing node:', error);
      toast.error(`Failed to test ${testType}`);
    }
  };

  const startServices = async (nodeId) => {
    try {
      toast.info('Starting services...');
      const response = await axios.post(`${API}/nodes/${nodeId}/services/start`);
      
      if (response.data.success) {
        toast.success('Services started successfully');
      } else {
        toast.error(`Failed to start services: ${response.data.message}`);
      }
      onNodeUpdated();
    } catch (error) {
      console.error('Error starting services:', error);
      toast.error('Failed to start services');
    }
  };

  const stopServices = async (nodeId) => {
    try {
      toast.info('Stopping services...');
      const response = await axios.post(`${API}/nodes/${nodeId}/services/stop`);
      
      if (response.data.success) {
        toast.success('Services stopped successfully');
      } else {
        toast.error(`Failed to stop services: ${response.data.message}`);
      }
      onNodeUpdated();
    } catch (error) {
      console.error('Error stopping services:', error);
      toast.error('Failed to stop services');
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
        <table className="min-w-full divide-y divide-gray-200" data-testid="nodes-table">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <Checkbox 
                  checked={selectedNodes.length === nodes.length && nodes.length > 0}
                  onCheckedChange={() => {
                    // This is handled by the parent component
                  }}
                />
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                IP
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Protocol
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Login
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Password
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                SOCKS
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Country
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                State
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                City
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                ZIP
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Provider
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Comment
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Last Update
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {nodes.map((node) => (
              <tr key={node.id} className="hover:bg-gray-50" data-testid={`node-row-${node.id}`}>
                <td className="px-6 py-4 whitespace-nowrap">
                  <Checkbox 
                    checked={selectedNodes.includes(node.id)}
                    onCheckedChange={() => onSelectNode(node.id)}
                    data-testid={`node-checkbox-${node.id}`}
                  />
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {getStatusBadge(node.status)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                  {node.ip}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  <Badge variant="outline">{node.protocol?.toUpperCase() || 'PPTP'}</Badge>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {node.login}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  <div className="flex items-center space-x-2">
                    <span>
                      {showPasswords[node.id] ? node.password : '••••••••'}
                    </span>
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      onClick={() => togglePasswordVisibility(node.id)}
                      data-testid={`toggle-password-${node.id}`}
                    >
                      {showPasswords[node.id] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    </Button>
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      onClick={() => copyToClipboard(node.password, 'Password')}
                      data-testid={`copy-password-${node.id}`}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  <Button 
                    size="sm" 
                    variant="outline" 
                    onClick={() => copySocks(node)}
                    data-testid={`copy-socks-${node.id}`}
                  >
                    <Copy className="h-3 w-3 mr-1" />
                    Copy SOCKS
                  </Button>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  <EditableCell node={node} field="country" />
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  <EditableCell node={node} field="state" />
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  <EditableCell node={node} field="city" />
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  <EditableCell node={node} field="zipcode" />
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  <EditableCell node={node} field="provider" />
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 max-w-xs">
                  <EditableCell node={node} field="comment" className="max-w-xs truncate" />
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {formatDate(node.last_update)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default NodesTable;
