import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTesting } from '../contexts/TestingContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { 
  Server, 
  Settings, 
  Search, 
  X, 
  Download, 
  Trash2, 
  LogOut,
  RefreshCw,
  Play,
  Square,
  Zap,
  Activity,
  Shield
} from 'lucide-react';
import NodesTable from './NodesTable';
import UnifiedImportModal from './UnifiedImportModal';
import ExportModal from './ExportModal';
import OptionsModal from './OptionsModal';
import TestingModal from './TestingModal';
import SOCKSModal from './SOCKSModal';
import axios from 'axios';

const AdminPanel = () => {
  const { user, logout, API } = useAuth();
  const { hasActiveSessions, getActiveSessionsCount, getActiveImportSession } = useTesting();
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedNodes, setSelectedNodes] = useState([]);
  const [allSelectedIds, setAllSelectedIds] = useState([]);  // All selected node IDs across all pages
  const [selectAllMode, setSelectAllMode] = useState(false);  // True when "Select All" is active
  const [selectAllCount, setSelectAllCount] = useState(0);  // Total count when selectAllMode is active
  const [stats, setStats] = useState({});
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  
  // Modals
  const [showImportModal, setShowImportModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [showTestingModal, setShowTestingModal] = useState(false);
  const [showSOCKSModal, setShowSOCKSModal] = useState(false);
  
  // Add state for format error modal
  const [showFormatErrorModal, setShowFormatErrorModal] = useState(false);
  const [formatErrorContent, setFormatErrorContent] = useState('');
  
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

  // Memoized filters to prevent unnecessary re-renders
  const activeFilters = useMemo(() => {
    return Object.fromEntries(
      Object.entries(filters).filter(([key, value]) => value !== '' && value !== false && value !== 'all')
    );
  }, [filters]);

  const loadNodes = useCallback(async (page = 1) => {
    try {
      setLoading(true);
      const params = {
        page,
        limit: 200,
        ...activeFilters
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
  }, [API, activeFilters]);

  const loadStats = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/stats`);
      setStats(response.data);
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  }, [API]);

  // Initial load
  useEffect(() => {
    loadNodes();
    loadStats();
  }, []);

  // Debounced filter effect
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      loadNodes(1);
      // Clear selection when filters change
      setSelectedNodes([]);
      setAllSelectedIds([]);
      setSelectAllMode(false);
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
  }, [loadNodes]);

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

  const getAllNodeIds = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/nodes/all-ids`, { params: activeFilters });
      return response.data.node_ids;
    } catch (error) {
      console.error('Error getting all node IDs:', error);
      toast.error('Failed to get all node IDs');
      return [];
    }
  }, [API, activeFilters]);

  const handleSelectAll = async () => {
    if (selectAllMode) {
      // Deselect all
      setSelectAllMode(false);
      setSelectedNodes([]);
      setAllSelectedIds([]);
      toast.info('Сброшен выбор всех узлов');
      return;
    }
    
    setLoading(true);
    try {
      // Получаем количество узлов без предварительных предупреждений
      const params = {
        ...activeFilters,
        count_only: true
      };
      
      const response = await axios.get(`${API}/nodes/count`, { params });
      const totalCount = response.data.count || 0;
      
      setSelectAllMode(true);
      setSelectAllCount(totalCount);  // Save total count
      setAllSelectedIds([]); // Не загружаем все ID в память
      
      // Выбираем только текущую страницу визуально
      const currentPageIds = nodes.map(node => node.id);
      setSelectedNodes(currentPageIds);
      
      toast.success(`Режим "Выбрать все" активен для ${totalCount} узлов`);
      toast.info(`💡 Операции будут применены ко всем ${totalCount} узлам, а не только к видимым`);
    } catch (error) {
      console.error('Error selecting all:', error);
      toast.error('Ошибка при получении количества узлов');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectNode = (nodeId) => {
    setSelectedNodes(prev => {
      const isCurrentlySelected = prev.includes(nodeId);
      if (isCurrentlySelected) {
        // Deselecting node
        const newSelected = prev.filter(id => id !== nodeId);
        
        // If we're in select all mode, remove from allSelectedIds too
        if (selectAllMode) {
          setAllSelectedIds(allIds => allIds.filter(id => id !== nodeId));
          // Check if we should exit select all mode
          if (allSelectedIds.length <= 1) {
            setSelectAllMode(false);
          }
        }
        
        return newSelected;
      } else {
        // Selecting node
        const newSelected = [...prev, nodeId];
        
        // If we're in select all mode, add to allSelectedIds too
        if (selectAllMode) {
          setAllSelectedIds(allIds => allIds.includes(nodeId) ? allIds : [...allIds, nodeId]);
        }
        
        return newSelected;
      }
    });
  };

  const handleDeleteSelected = async () => {
    if (selectAllMode) {
      // Quick confirm for bulk delete
      const countResponse = await axios.get(`${API}/nodes/count`, { params: activeFilters });
      const totalCount = countResponse.data.count || 0;
      
      const confirmed = window.confirm(`Удалить ${totalCount} узлов с текущими фильтрами?`);
      if (!confirmed) return;
      
      setLoading(true);
      try {
        // Use bulk delete with filters - add delete_all for selectAll mode
        const bulkParams = {
          ...activeFilters,
          delete_all: Object.keys(activeFilters).length === 0 ? 'true' : 'false'
        };
        
        const response = await axios({
          method: 'delete',
          url: `${API}/nodes/bulk`,
          params: bulkParams
        });
        
        const deletedCount = response.data.deleted_count || totalCount;
        toast.success(`✅ Удалено ${deletedCount} узлов с текущими фильтрами`);
        
        // Reset selections and reload
        setSelectedNodes([]);
        setSelectAllMode(false);
        setAllSelectedIds([]);
        loadNodes(1); // Start from first page
        loadStats();
      } catch (error) {
        console.error('Error bulk deleting nodes:', error);
        let errorMsg = 'Ошибка массового удаления узлов';
        
        if (error.response?.data?.detail) {
          if (typeof error.response.data.detail === 'string') {
            errorMsg = error.response.data.detail;
          } else {
            errorMsg = JSON.stringify(error.response.data.detail);
          }
        } else if (error.message) {
          errorMsg = error.message;
        }
        
        toast.error(`❌ ${errorMsg}`);
        console.log('Full error object:', error);
      } finally {
        setLoading(false);
      }
    } else {
      // Regular delete for individual selected nodes
      if (!selectedNodes.length) {
        toast.error('Узлы не выбраны');
        return;
      }

      const confirmed = window.confirm(`Удалить ${selectedNodes.length} выбранных узлов?`);
      if (!confirmed) return;

      setLoading(true);
      try {
        await axios.delete(`${API}/nodes`, {
          data: { node_ids: selectedNodes }
        });
        toast.success(`✅ Удалено ${selectedNodes.length} узлов`);
        
        // Reset selections and reload
        setSelectedNodes([]);
        loadNodes(currentPage);
        loadStats();
      } catch (error) {
        console.error('Error deleting selected nodes:', error);
        toast.error('❌ Ошибка удаления выбранных узлов');
      } finally {
        setLoading(false);
      }
    }
  };

  const handleStartServices = async () => {
    const targetIds = selectAllMode ? allSelectedIds : selectedNodes;
    
    if (!targetIds.length) {
      toast.error('No nodes selected');
      return;
    }

    try {
      const response = await axios.post(`${API}/services/start`, {
        node_ids: targetIds,
        action: 'start'
      });

      const results = response.data.results;
      const successCount = results.filter(r => r.success).length;
      const failCount = results.length - successCount;
      
      if (successCount > 0) {
        toast.success(`Started services for ${successCount} nodes`);
      }
      if (failCount > 0) {
        toast.error(`Failed to start ${failCount} services`);
      }

      loadNodes(currentPage);
      loadStats();
    } catch (error) {
      console.error('Error starting services:', error);
      toast.error('Failed to start services: ' + (error.response?.data?.detail || error.message));
    }
  };

  const handleStopServices = async () => {
    const targetIds = selectAllMode ? allSelectedIds : selectedNodes;
    
    if (!targetIds.length) {
      toast.error('No nodes selected');
      return;
    }

    try {
      const response = await axios.post(`${API}/services/stop`, {
        node_ids: targetIds,
        action: 'stop'
      });

      const results = response.data.results;
      const successCount = results.filter(r => r.success).length;
      const failCount = results.length - successCount;
      
      if (successCount > 0) {
        toast.success(`Stopped services for ${successCount} nodes`);
      }
      if (failCount > 0) {
        toast.error(`Failed to stop ${failCount} services`);
      }

      loadNodes(currentPage);
      loadStats();
    } catch (error) {
      console.error('Error stopping services:', error);
      toast.error('Failed to stop services: ' + (error.response?.data?.detail || error.message));
    }
  };

  const handleNodeUpdated = () => {
    loadNodes(currentPage);
    loadStats();
  };

  // ===== MAIN SERVICE HANDLERS =====

  const handleImportComplete = (report) => {
    // Show detailed import report
    if (report) {
      const { added, skipped_duplicates, format_errors, replaced_old, queued_for_verification } = report;
      let message = `Import complete: ${added} added`;
      if (skipped_duplicates > 0) message += `, ${skipped_duplicates} duplicates skipped`;
      if (replaced_old > 0) message += `, ${replaced_old} old configs replaced`;
      if (queued_for_verification > 0) message += `, ${queued_for_verification} queued for verification`;
      if (format_errors > 0) message += `, ${format_errors} format errors`;
      
      toast.success(message);
    }
  };

  const handleFormatErrorClick = async () => {
    try {
      const response = await axios.get(`${API}/format-errors`);
      setFormatErrorContent(response.data.content || "No format errors found");
      setShowFormatErrorModal(true);
    } catch (error) {
      console.error('Error loading format errors:', error);
      toast.error('Failed to load format errors');
    }
  };

  const handleClearFormatErrors = async () => {
    try {
      await axios.delete(`${API}/format-errors`);
      setFormatErrorContent("");
      toast.success('Format errors cleared');
    } catch (error) {
      console.error('Error clearing format errors:', error);
      toast.error('Failed to clear format errors');
    }
  };

  const getStatusBadge = (status) => {
    const variants = {
      not_tested: 'bg-gray-100 text-gray-800',
      ping_light: 'bg-yellow-100 text-yellow-800',
      ping_failed: 'bg-red-100 text-red-800', 
      ping_ok: 'bg-orange-100 text-orange-800',
      speed_ok: 'bg-blue-100 text-blue-800',
      offline: 'bg-red-100 text-red-800',
      online: 'bg-green-100 text-green-800'
    };
    
    return (
      <Badge className={variants[status] || variants.not_tested}>
        {status?.replace('_', ' ') || 'not tested'}
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
                <div className="flex items-center space-x-3">
                  <h1 className="text-2xl font-bold text-gray-900">Connexa Admin Panel</h1>
                  {/* Import Status Indicator */}
                  {(() => {
                    // Check for active imports
                    const activeImportSession = localStorage.getItem('activeImportSession');
                    const activeRegularImport = localStorage.getItem('activeRegularImport');
                    
                    if (activeImportSession || activeRegularImport) {
                      return (
                        <div className="flex items-center bg-blue-100 border border-blue-300 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">
                          <Activity className="h-4 w-4 mr-1 animate-spin" />
                          Импорт активен
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
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
        <div className="grid grid-cols-1 md:grid-cols-8 gap-4 mb-6">
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{stats.total || 0}</div>
              <p className="text-xs text-muted-foreground">Total Nodes</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-gray-600">{stats.not_tested || 0}</div>
              <p className="text-xs text-muted-foreground">⚫ Not Tested</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-red-600">{stats.ping_failed || 0}</div>
              <p className="text-xs text-muted-foreground">🔴 PING Failed</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-yellow-600">{stats.ping_light || 0}</div>
              <p className="text-xs text-muted-foreground">🟡 PING LIGHT</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-orange-600">{stats.ping_ok || 0}</div>
              <p className="text-xs text-muted-foreground">🟠 PING OK</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-blue-600">{stats.speed_ok || 0}</div>
              <p className="text-xs text-muted-foreground">🔵 Speed OK</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-green-600">{stats.online || 0}</div>
              <p className="text-xs text-muted-foreground">🟢 Online</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-purple-600">{stats.socks_online || 0}</div>
              <p className="text-xs text-muted-foreground">🟣 Socks Online</p>
            </CardContent>
          </Card>
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
                  <SelectItem value="not_tested">Not Tested</SelectItem>
                  <SelectItem value="ping_light">PING LIGHT</SelectItem>
                  <SelectItem value="ping_failed">PING Failed</SelectItem>
                  <SelectItem value="ping_ok">PING OK</SelectItem>
                  <SelectItem value="speed_ok">Speed OK</SelectItem>
                  <SelectItem value="offline">Offline</SelectItem>
                  <SelectItem value="online">Online</SelectItem>
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
              
              {/* Start/Stop Services Buttons */}
              <div className="flex gap-2 ml-4 pl-4 border-l border-gray-300">
                <Button 
                  onClick={handleStartServices}
                  disabled={!selectAllMode && selectedNodes.length === 0}
                  className="bg-green-600 hover:bg-green-700"
                  data-testid="start-services-btn"
                >
                  <Play className="h-4 w-4 mr-2" />
                  Start Services
                </Button>
                <Button 
                  onClick={handleStopServices}
                  disabled={!selectAllMode && selectedNodes.length === 0}
                  variant="destructive"
                  data-testid="stop-services-btn"
                >
                  <Square className="h-4 w-4 mr-2" />
                  Stop Services
                </Button>
                
                {/* Import and Testing Actions */}
                <Button 
                  onClick={() => setShowImportModal(true)}
                  data-testid="import-btn"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Import
                </Button>
                <Button 
                  variant={hasActiveSessions() ? "default" : "outline"} 
                  onClick={() => setShowTestingModal(true)}
                  data-testid="testing-btn"
                  className={hasActiveSessions() ? "relative" : ""}
                >
                  <Activity className="h-4 w-4 mr-2" />
                  Testing
                  {hasActiveSessions() && (
                    <Badge variant="destructive" className="ml-2 h-5 w-5 p-0 flex items-center justify-center text-xs">
                      {getActiveSessionsCount()}
                    </Badge>
                  )}
                </Button>
                <Button 
                  onClick={() => setShowSOCKSModal(true)}
                  disabled={!selectAllMode && selectedNodes.length === 0}
                  variant="outline"
                  data-testid="socks-btn"
                  className="bg-purple-50 hover:bg-purple-100 border-purple-200"
                >
                  <Shield className="h-4 w-4 mr-2" />
                  SOCKS
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Mass Actions */}
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="flex items-center space-x-2">
            <Checkbox 
              checked={selectAllMode || (selectedNodes.length === nodes.length && nodes.length > 0)}
              onCheckedChange={handleSelectAll}
              data-testid="select-all-checkbox"
            />
            <span className="text-sm">
              Select All ({selectAllMode ? allSelectedIds.length : selectedNodes.length} selected
              {selectAllMode && ` total, ${selectedNodes.length} visible`})
            </span>
          </div>
          
          {(selectedNodes.length > 0 || selectAllMode) && (
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
          
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleFormatErrorClick}
            data-testid="format-error-btn"
          >
            <Zap className="h-4 w-4 mr-2" />
            Format Error
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
      <UnifiedImportModal 
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onComplete={(report) => {
          loadNodes(currentPage);
          loadStats();
          if (report) {
            handleImportComplete(report);
          }
        }}
      />
      
      <ExportModal 
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        selectedNodeIds={selectAllMode ? allSelectedIds : selectedNodes}
      />
      
      <OptionsModal 
        isOpen={showOptionsModal}
        onClose={() => setShowOptionsModal(false)}
      />
      
      <TestingModal 
        isOpen={showTestingModal}
        onClose={() => setShowTestingModal(false)}
        selectedNodeIds={selectedNodes}
        selectAllMode={selectAllMode}
        onTestComplete={() => {
          loadNodes(currentPage);
          loadStats();
        }}
      />
      
      <SOCKSModal 
        isOpen={showSOCKSModal}
        onClose={() => setShowSOCKSModal(false)}
        selectedNodeIds={selectAllMode ? allSelectedIds : selectedNodes}
      />
      
      {/* Format Error Modal */}
      <Dialog open={showFormatErrorModal} onOpenChange={setShowFormatErrorModal}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Format Errors</DialogTitle>
            <DialogDescription>
              Review parsing errors and invalid formats
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            <div className="border rounded-lg p-4 bg-gray-50 max-h-96 overflow-y-auto">
              <pre className="text-sm whitespace-pre-wrap font-mono">
                {formatErrorContent || "No format errors found"}
              </pre>
            </div>
            <div className="flex justify-between mt-4">
              <Button variant="outline" onClick={() => setShowFormatErrorModal(false)}>
                Close
              </Button>
              <Button variant="destructive" onClick={handleClearFormatErrors}>
                Clear All Errors
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminPanel;
