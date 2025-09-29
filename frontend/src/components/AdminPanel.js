import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { 
  Server, 
  Plus, 
  Settings, 
  Search, 
  X, 
  Download, 
  Trash2, 
  MoreHorizontal,
  Eye,
  EyeOff,
  Copy,
  LogOut,
  RefreshCw,
  Play,
  Square,
  Zap,
  Activity
} from 'lucide-react';
import NodesTable from './NodesTable';
import AddNodeModal from './AddNodeModal';
import ImportModal from './ImportModal';
import ExportModal from './ExportModal';
import OptionsModal from './OptionsModal';
import ServiceControlModal from './ServiceControlModal';
import TestingModal from './TestingModal';
import axios from 'axios';

const AdminPanel = () => {
  const { user, logout, API } = useAuth();
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedNodes, setSelectedNodes] = useState([]);
  const [stats, setStats] = useState({});
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  
  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [showServiceControlModal, setShowServiceControlModal] = useState(false);
  const [showTestingModal, setShowTestingModal] = useState(false);
  
  // Filters
  const [filters, setFilters] = useState({
    ip: '',
    provider: '',
    country: '',
    state: '',
    city: '',
    zipcode: '',
    login: '',
    comment: '',
    status: 'all',
    protocol: 'all',
    only_online: false
  });

  const loadNodes = async (page = 1) => {
    try {
      setLoading(true);
      const params = {
        page,
        limit: 200,
        ...Object.fromEntries(
          Object.entries(filters).filter(([key, value]) => value !== '' && value !== false && value !== 'all')
        )
      };
      
      const response = await axios.get(`${API}/nodes`, { params });
      setNodes(response.data.nodes);
      setCurrentPage(response.data.page);
      setTotalPages(response.data.total_pages);
    } catch (error) {
      console.error('Error loading nodes:', error);
      toast.error('Failed to load nodes');
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const response = await axios.get(`${API}/stats`);
      setStats(response.data);
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  };

  useEffect(() => {
    loadNodes();
    loadStats();
  }, [filters]);

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const resetFilters = () => {
    setFilters({
      ip: '',
      provider: '',
      country: '',
      state: '',
      city: '',
      zipcode: '',
      login: '',
      comment: '',
      status: '',
      protocol: '',
      only_online: false
    });
  };

  const handleSelectAll = () => {
    if (selectedNodes.length === nodes.length) {
      setSelectedNodes([]);
    } else {
      setSelectedNodes(nodes.map(node => node.id));
    }
  };

  const handleSelectNode = (nodeId) => {
    setSelectedNodes(prev => 
      prev.includes(nodeId) 
        ? prev.filter(id => id !== nodeId)
        : [...prev, nodeId]
    );
  };

  const handleDeleteSelected = async () => {
    if (!selectedNodes.length) {
      toast.error('No nodes selected');
      return;
    }

    if (!window.confirm(`Delete ${selectedNodes.length} selected nodes?`)) {
      return;
    }

    try {
      await axios.delete(`${API}/nodes`, {
        data: selectedNodes
      });
      toast.success(`Deleted ${selectedNodes.length} nodes`);
      setSelectedNodes([]);
      loadNodes(currentPage);
      loadStats();
    } catch (error) {
      console.error('Error deleting nodes:', error);
      toast.error('Failed to delete nodes');
    }
  };

  const handleNodeAdded = () => {
    loadNodes(currentPage);
    loadStats();
    setShowAddModal(false);
  };

  const handleNodeUpdated = () => {
    loadNodes(currentPage);
    loadStats();
  };

  const handleImportComplete = () => {
    loadNodes(currentPage);
    loadStats();
    setShowImportModal(false);
  };

  const getStatusBadge = (status) => {
    const variants = {
      online: 'bg-green-100 text-green-800',
      offline: 'bg-red-100 text-red-800',
      checking: 'bg-yellow-100 text-yellow-800',
      degraded: 'bg-orange-100 text-orange-800',
      needs_review: 'bg-gray-100 text-gray-800'
    };
    
    return (
      <Badge className={variants[status] || variants.offline}>
        {status}
      </Badge>
    );
  };

  if (loading && nodes.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading admin panel...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50" data-testid="admin-panel">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-4">
              <Server className="h-8 w-8 text-blue-600" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Connexa Admin Panel</h1>
                <p className="text-sm text-gray-500">VPN Management System v1.7</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">Welcome, {user?.username}</span>
              <Button variant="outline" size="sm" onClick={() => setShowOptionsModal(true)}>
                <Settings className="h-4 w-4 mr-2" />
                Options
              </Button>
              <Button variant="outline" size="sm" onClick={logout}>
                <LogOut className="h-4 w-4 mr-2" />
                Logout
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{stats.total || 0}</div>
              <p className="text-xs text-muted-foreground">Total Nodes</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-green-600">{stats.online || 0}</div>
              <p className="text-xs text-muted-foreground">Online</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-red-600">{stats.offline || 0}</div>
              <p className="text-xs text-muted-foreground">Offline</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-yellow-600">{stats.checking || 0}</div>
              <p className="text-xs text-muted-foreground">Checking</p>
            </CardContent>
          </Card>
        </div>

        {/* Control Buttons */}
        <div className="flex flex-wrap gap-3 mb-6">
          <Button onClick={() => setShowAddModal(true)} data-testid="add-server-btn">
            <Plus className="h-4 w-4 mr-2" />
            Add Server
          </Button>
          <Button variant="outline" onClick={() => setShowImportModal(true)} data-testid="import-btn">
            <Download className="h-4 w-4 mr-2" />
            Import
          </Button>
          <Button variant="outline" onClick={() => setShowServiceControlModal(true)} data-testid="service-control-btn">
            <Zap className="h-4 w-4 mr-2" />
            Service Control
          </Button>
          <Button variant="outline" onClick={() => setShowTestingModal(true)} data-testid="testing-btn">
            <Activity className="h-4 w-4 mr-2" />
            Testing
          </Button>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-4">
              <Input
                placeholder="IP Address"
                value={filters.ip}
                onChange={(e) => handleFilterChange('ip', e.target.value)}
                data-testid="filter-ip"
              />
              <Input
                placeholder="Provider"
                value={filters.provider}
                onChange={(e) => handleFilterChange('provider', e.target.value)}
                data-testid="filter-provider"
              />
              <Input
                placeholder="Country"
                value={filters.country}
                onChange={(e) => handleFilterChange('country', e.target.value)}
                data-testid="filter-country"
              />
              <Input
                placeholder="State"
                value={filters.state}
                onChange={(e) => handleFilterChange('state', e.target.value)}
                data-testid="filter-state"
              />
              <Input
                placeholder="City"
                value={filters.city}
                onChange={(e) => handleFilterChange('city', e.target.value)}
                data-testid="filter-city"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-4">
              <Input
                placeholder="ZIP Code"
                value={filters.zipcode}
                onChange={(e) => handleFilterChange('zipcode', e.target.value)}
                data-testid="filter-zip"
              />
              <Input
                placeholder="Login"
                value={filters.login}
                onChange={(e) => handleFilterChange('login', e.target.value)}
                data-testid="filter-login"
              />
              <Input
                placeholder="Comment"
                value={filters.comment}
                onChange={(e) => handleFilterChange('comment', e.target.value)}
                data-testid="filter-comment"
              />
              <Select value={filters.status} onValueChange={(value) => handleFilterChange('status', value)}>
                <SelectTrigger data-testid="filter-status">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="online">Online</SelectItem>
                  <SelectItem value="offline">Offline</SelectItem>
                  <SelectItem value="checking">Checking</SelectItem>
                  <SelectItem value="degraded">Degraded</SelectItem>
                  <SelectItem value="needs_review">Needs Review</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filters.protocol} onValueChange={(value) => handleFilterChange('protocol', value)}>
                <SelectTrigger data-testid="filter-protocol">
                  <SelectValue placeholder="Protocol" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Protocols</SelectItem>
                  <SelectItem value="pptp">PPTP</SelectItem>
                  <SelectItem value="ssh">SSH</SelectItem>
                  <SelectItem value="socks">SOCKS</SelectItem>
                  <SelectItem value="server">SERVER</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => loadNodes(1)} data-testid="search-btn">
                <Search className="h-4 w-4 mr-2" />
                Search
              </Button>
              <Button variant="outline" onClick={resetFilters} data-testid="reset-filters-btn">
                <X className="h-4 w-4 mr-2" />
                Reset
              </Button>
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="only-online" 
                  checked={filters.only_online}
                  onCheckedChange={(checked) => handleFilterChange('only_online', checked)}
                  data-testid="only-online-checkbox"
                />
                <label htmlFor="only-online" className="text-sm font-medium">Only Online</label>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Mass Actions */}
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="flex items-center space-x-2">
            <Checkbox 
              checked={selectedNodes.length === nodes.length && nodes.length > 0}
              onCheckedChange={handleSelectAll}
              data-testid="select-all-checkbox"
            />
            <span className="text-sm">Select All ({selectedNodes.length} selected)</span>
          </div>
          
          {selectedNodes.length > 0 && (
            <>
              <Button 
                variant="destructive" 
                size="sm" 
                onClick={handleDeleteSelected}
                data-testid="delete-selected-btn"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Selected
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setShowExportModal(true)}
                data-testid="export-selected-btn"
              >
                <Download className="h-4 w-4 mr-2" />
                Export Selected
              </Button>
            </>
          )}
          
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => loadNodes(currentPage)}
            data-testid="refresh-btn"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Nodes Table */}
        <NodesTable 
          nodes={nodes}
          selectedNodes={selectedNodes}
          onSelectNode={handleSelectNode}
          onNodeUpdated={handleNodeUpdated}
          loading={loading}
        />

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center mt-6">
            <div className="flex space-x-2">
              <Button 
                variant="outline" 
                disabled={currentPage === 1}
                onClick={() => loadNodes(currentPage - 1)}
              >
                Previous
              </Button>
              <span className="px-3 py-2 text-sm">
                Page {currentPage} of {totalPages}
              </span>
              <Button 
                variant="outline" 
                disabled={currentPage === totalPages}
                onClick={() => loadNodes(currentPage + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      <AddNodeModal 
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onNodeAdded={handleNodeAdded}
      />
      
      <ImportModal 
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImportComplete={handleImportComplete}
      />
      
      <ExportModal 
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        selectedNodeIds={selectedNodes}
      />
      
      <OptionsModal 
        isOpen={showOptionsModal}
        onClose={() => setShowOptionsModal(false)}
      />
      
      <ServiceControlModal 
        isOpen={showServiceControlModal}
        onClose={() => setShowServiceControlModal(false)}
      />
      
      <TestingModal 
        isOpen={showTestingModal}
        onClose={() => setShowTestingModal(false)}
      />
    </div>
  );
};

export default AdminPanel;
