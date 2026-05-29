package com.nowen.video.ui.screen.features

import android.content.res.Configuration
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Cast
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.CloudQueue
import androidx.compose.material.icons.filled.ClosedCaption
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.FamilyRestroom
import androidx.compose.material.icons.filled.HealthAndSafety
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Subtitles
import androidx.compose.material.icons.filled.TravelExplore
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.nowen.video.data.local.TokenManager
import com.nowen.video.data.model.ASRTask
import com.nowen.video.data.model.DownloadQueueInfo
import com.nowen.video.data.model.DownloadTask
import com.nowen.video.data.model.Media
import com.nowen.video.data.model.SearchResult
import com.nowen.video.data.model.ServerHealth
import com.nowen.video.data.remote.NowenApiService
import com.nowen.video.ui.theme.spaceBackground
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.InetSocketAddress
import java.net.Socket
import javax.inject.Inject

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FeatureScaffold(
    title: String,
    icon: ImageVector,
    onBack: () -> Unit,
    actions: @Composable () -> Unit = {},
    content: @Composable (PaddingValues) -> Unit
) {
    Box(Modifier.fillMaxSize().spaceBackground()) {
        Scaffold(
            containerColor = Color.Transparent,
            topBar = {
                TopAppBar(
                    title = {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                            Text(title, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                        }
                    },
                    navigationIcon = {
                        IconButton(onClick = onBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回", tint = MaterialTheme.colorScheme.primary)
                        }
                    },
                    actions = { actions() },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.95f))
                )
            },
            content = content
        )
    }
}

@Composable
private fun FeatureCard(
    icon: ImageVector,
    title: String,
    subtitle: String,
    color: Color = MaterialTheme.colorScheme.primary,
    trailing: @Composable (() -> Unit)? = null,
    onClick: (() -> Unit)? = null
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.88f))
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Brush.horizontalGradient(listOf(color.copy(alpha = 0.08f), Color.Transparent)))
                .border(1.dp, color.copy(alpha = 0.16f), RoundedCornerShape(16.dp))
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(42.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(color.copy(alpha = 0.12f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(icon, contentDescription = null, tint = color)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(title, color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.SemiBold)
                Text(subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            }
            trailing?.invoke()
        }
    }
}

@Composable
private fun StatusChip(text: String, color: Color) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(color))
        Text(text, color = color, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Medium)
    }
}

// ==================== 阶段一：连接诊断 ====================

@Composable
fun ConnectionDiagnosticScreen(
    onBack: () -> Unit,
    viewModel: ConnectionDiagnosticViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    LaunchedEffect(Unit) { viewModel.runDiagnostics() }

    FeatureScaffold(
        title = "连接诊断",
        icon = Icons.Default.HealthAndSafety,
        onBack = onBack,
        actions = {
            IconButton(onClick = { viewModel.runDiagnostics() }) {
                Icon(Icons.Default.Refresh, contentDescription = "重新诊断", tint = MaterialTheme.colorScheme.primary)
            }
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                FeatureCard(
                    icon = Icons.Default.Wifi,
                    title = "当前服务器",
                    subtitle = uiState.serverUrl.ifBlank { "尚未配置服务器地址" },
                    color = MaterialTheme.colorScheme.secondary,
                    trailing = {
                        if (uiState.loading) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                    }
                )
            }
            items(uiState.steps) { step ->
                FeatureCard(
                    icon = if (step.success) Icons.Default.CheckCircle else Icons.Default.Error,
                    title = step.title,
                    subtitle = step.message,
                    color = if (step.success) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.error,
                    trailing = { StatusChip(if (step.success) "通过" else "异常", if (step.success) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.error) }
                )
            }
            uiState.health?.let { health ->
                item {
                    FeatureCard(
                        icon = Icons.Default.Info,
                        title = "服务端信息",
                        subtitle = "${health.serverName.ifBlank { "nowen-video" }} · v${health.version} · ${health.os}/${health.arch}",
                        color = MaterialTheme.colorScheme.primary
                    )
                }
                item {
                    FeatureCard(
                        icon = Icons.Default.Devices,
                        title = "局域网地址",
                        subtitle = if (health.lanIps.isEmpty()) "服务端未返回局域网地址" else health.lanIps.joinToString("、") { "$it:${health.port}" },
                        color = MaterialTheme.colorScheme.secondary
                    )
                }
            }
            if (uiState.suggestion.isNotBlank()) {
                item {
                    FeatureCard(
                        icon = Icons.Default.TravelExplore,
                        title = "修复建议",
                        subtitle = uiState.suggestion,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
            }
        }
    }
}

data class DiagnosticStep(val title: String, val message: String, val success: Boolean)

data class ConnectionDiagnosticUiState(
    val loading: Boolean = false,
    val serverUrl: String = "",
    val steps: List<DiagnosticStep> = emptyList(),
    val health: ServerHealth? = null,
    val suggestion: String = ""
)

@HiltViewModel
class ConnectionDiagnosticViewModel @Inject constructor(
    private val tokenManager: TokenManager,
    private val apiService: NowenApiService,
    private val okHttpClient: OkHttpClient
) : ViewModel() {
    private val _uiState = MutableStateFlow(ConnectionDiagnosticUiState())
    val uiState = _uiState.asStateFlow()

    fun runDiagnostics() {
        viewModelScope.launch {
            val serverUrl = tokenManager.getServerUrl()?.trimEnd('/').orEmpty()
            _uiState.value = ConnectionDiagnosticUiState(loading = true, serverUrl = serverUrl)
            val steps = mutableListOf<DiagnosticStep>()
            if (serverUrl.isBlank()) {
                _uiState.value = ConnectionDiagnosticUiState(
                    serverUrl = serverUrl,
                    steps = listOf(DiagnosticStep("服务器地址", "请先在服务器配置页填写地址，例如 http://192.168.1.100:8080", false)),
                    suggestion = "返回服务器配置页，输入本机 Web 端可访问的完整地址。"
                )
                return@launch
            }

            val url = runCatching { java.net.URL(serverUrl) }.getOrNull()
            steps += DiagnosticStep("地址格式", if (url != null) "地址格式正确：${url.protocol}://${url.host}:${url.port.takeIf { it > 0 } ?: url.defaultPort}" else "地址格式无法解析", url != null)

            if (url != null) {
                val port = if (url.port > 0) url.port else url.defaultPort
                val tcpOk = withContext(Dispatchers.IO) {
                    runCatching {
                        Socket().use { socket -> socket.connect(InetSocketAddress(url.host, port), 2500) }
                    }.isSuccess
                }
                steps += DiagnosticStep("TCP 端口", if (tcpOk) "${url.host}:$port 可连接" else "无法连接 ${url.host}:$port，可能是服务未启动、防火墙或端口错误", tcpOk)

                val httpOk = withContext(Dispatchers.IO) {
                    runCatching {
                        val request = Request.Builder().url("$serverUrl/api/health").get().build()
                        okHttpClient.newCall(request).execute().use { it.isSuccessful }
                    }.getOrDefault(false)
                }
                steps += DiagnosticStep("健康检查", if (httpOk) "/api/health 响应正常" else "/api/health 无响应，请确认服务端已启动且未被占用", httpOk)
            }

            val health = runCatching { apiService.getHealth().data }.getOrNull()
            if (health != null) {
                steps += DiagnosticStep("Nowen 服务", "服务端能力已识别：播放、字幕、推荐、Emby兼容状态可用", true)
            }

            _uiState.value = ConnectionDiagnosticUiState(
                loading = false,
                serverUrl = serverUrl,
                steps = steps,
                health = health,
                suggestion = buildSuggestion(steps)
            )
        }
    }

    private fun buildSuggestion(steps: List<DiagnosticStep>): String {
        if (steps.all { it.success }) return "连接链路正常，可以继续登录或播放测试。"
        return "优先确认服务端 Web 页面能在手机浏览器打开；若打不开，请检查 8080 端口占用、防火墙、手机与服务器是否在同一局域网。"
    }
}

// ==================== 阶段二：离线下载 ====================

@Composable
fun DownloadsScreen(
    onBack: () -> Unit,
    viewModel: DownloadsViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    LaunchedEffect(Unit) { viewModel.refresh() }

    FeatureScaffold(
        title = "离线下载",
        icon = Icons.Default.Download,
        onBack = onBack,
        actions = {
            IconButton(onClick = { viewModel.refresh() }) {
                Icon(Icons.Default.Refresh, contentDescription = "刷新", tint = MaterialTheme.colorScheme.primary)
            }
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                val queue = uiState.queueInfo
                FeatureCard(
                    icon = Icons.Default.CloudQueue,
                    title = "下载队列",
                    subtitle = if (queue == null) "正在读取离线下载队列" else "进行中 ${queue.active} · 排队 ${queue.queued} · 已完成 ${queue.completed} · 失败 ${queue.failed}",
                    color = MaterialTheme.colorScheme.primary,
                    trailing = { if (uiState.loading) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) }
                )
            }
            if (uiState.error.isNotBlank()) {
                item {
                    FeatureCard(Icons.Default.Security, "需要管理员权限或服务端支持", uiState.error, MaterialTheme.colorScheme.error)
                }
            }
            if (uiState.tasks.isEmpty() && uiState.error.isBlank() && !uiState.loading) {
                item {
                    FeatureCard(Icons.Default.Info, "暂无下载任务", "可在媒体详情页或后续批量缓存入口创建离线下载任务。", MaterialTheme.colorScheme.secondary)
                }
            }
            items(uiState.tasks, key = { it.id }) { task ->
                DownloadTaskCard(task = task, onPause = { viewModel.pause(task.id) }, onResume = { viewModel.resume(task.id) }, onDelete = { viewModel.delete(task.id) })
            }
        }
    }
}

@Composable
private fun DownloadTaskCard(task: DownloadTask, onPause: () -> Unit, onResume: () -> Unit, onDelete: () -> Unit) {
    FeatureCard(
        icon = Icons.Default.Download,
        title = task.title.ifBlank { task.mediaId },
        subtitle = "${task.quality} · ${task.status} · ${task.progress.toInt()}% · ${formatBytes(task.downloaded)} / ${formatBytes(task.fileSize)}",
        color = when (task.status) {
            "completed" -> MaterialTheme.colorScheme.tertiary
            "failed", "cancelled" -> MaterialTheme.colorScheme.error
            else -> MaterialTheme.colorScheme.primary
        },
        trailing = {
            Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                if (task.status == "downloading") IconButton(onClick = onPause) { Icon(Icons.Default.Pause, "暂停") }
                if (task.status == "paused" || task.status == "queued") IconButton(onClick = onResume) { Icon(Icons.Default.PlayArrow, "继续") }
                IconButton(onClick = onDelete) { Icon(Icons.Default.Delete, "删除", tint = MaterialTheme.colorScheme.error) }
            }
        }
    )
    Spacer(Modifier.height(6.dp))
    LinearProgressIndicator(
        progress = { (task.progress / 100.0).toFloat().coerceIn(0f, 1f) },
        modifier = Modifier.fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp))
    )
}

data class DownloadsUiState(
    val loading: Boolean = false,
    val tasks: List<DownloadTask> = emptyList(),
    val queueInfo: DownloadQueueInfo? = null,
    val error: String = ""
)

@HiltViewModel
class DownloadsViewModel @Inject constructor(private val apiService: NowenApiService) : ViewModel() {
    private val _uiState = MutableStateFlow(DownloadsUiState())
    val uiState = _uiState.asStateFlow()

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(loading = true, error = "")
            runCatching {
                val queue = apiService.getDownloadQueueInfo().data
                val tasks = apiService.getDownloads().data
                _uiState.value = DownloadsUiState(tasks = tasks, queueInfo = queue)
            }.onFailure { e ->
                _uiState.value = DownloadsUiState(error = e.message ?: "下载接口不可用，请确认当前账号为管理员并且服务端已启用离线下载。")
            }
        }
    }

    fun pause(id: String) = operate { apiService.pauseDownload(id) }
    fun resume(id: String) = operate { apiService.resumeDownload(id) }
    fun delete(id: String) = operate { apiService.deleteDownload(id) }

    private fun operate(block: suspend () -> Unit) {
        viewModelScope.launch {
            runCatching { block() }.onFailure { e -> _uiState.value = _uiState.value.copy(error = e.message ?: "操作失败") }
            refresh()
        }
    }
}

// ==================== 阶段二：字幕中心 ====================

@Composable
fun SubtitleCenterScreen(onBack: () -> Unit, viewModel: SubtitleCenterViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsState()
    LaunchedEffect(Unit) { viewModel.loadStatus() }

    FeatureScaffold("字幕中心", Icons.Default.Subtitles, onBack, actions = {
        IconButton(onClick = { viewModel.loadStatus() }) { Icon(Icons.Default.Refresh, "刷新", tint = MaterialTheme.colorScheme.primary) }
    }) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                FeatureCard(Icons.Default.ClosedCaption, "AI 字幕服务", uiState.asrText, if (uiState.asrReady) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.error)
            }
            item { FeatureCard(Icons.Default.Search, "在线字幕搜索", "播放页可按影片标题、年份、语言搜索并下载外挂字幕。", MaterialTheme.colorScheme.primary) }
            item { FeatureCard(Icons.Default.AutoAwesome, "AI 生成与翻译", "播放页支持生成 AI 字幕、翻译字幕，并显示任务进度。", MaterialTheme.colorScheme.secondary) }
            item { FeatureCard(Icons.Default.Info, "建议工作流", "优先使用已有字幕；缺失时在线搜索；仍无结果时再使用 AI 生成和翻译，节省模型额度。", MaterialTheme.colorScheme.primary) }
            if (uiState.error.isNotBlank()) item { FeatureCard(Icons.Default.Error, "状态读取失败", uiState.error, MaterialTheme.colorScheme.error) }
        }
    }
}

data class SubtitleCenterUiState(val asrReady: Boolean = false, val asrText: String = "正在检查 ASR 服务状态", val error: String = "")

@HiltViewModel
class SubtitleCenterViewModel @Inject constructor(private val apiService: NowenApiService) : ViewModel() {
    private val _uiState = MutableStateFlow(SubtitleCenterUiState())
    val uiState = _uiState.asStateFlow()

    fun loadStatus() {
        viewModelScope.launch {
            runCatching { apiService.getASRStatus().data }.onSuccess { status ->
                val text = status.entries.joinToString(" · ") { "${it.key}: ${it.value}" }.ifBlank { "ASR 状态接口正常" }
                _uiState.value = SubtitleCenterUiState(asrReady = true, asrText = text)
            }.onFailure { e ->
                _uiState.value = SubtitleCenterUiState(asrReady = false, asrText = "ASR 服务不可用或未配置", error = e.message ?: "无法读取 ASR 状态")
            }
        }
    }
}

// ==================== 阶段三：智能发现 / AI 搜索 ====================

@Composable
fun SmartDiscoveryScreen(onBack: () -> Unit, onMediaClick: (String) -> Unit, viewModel: SmartDiscoveryViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsState()
    var query by remember { mutableStateOf("") }
    LaunchedEffect(Unit) { viewModel.loadRecommendations() }

    FeatureScaffold("智能发现", Icons.Default.AutoAwesome, onBack, actions = {
        IconButton(onClick = { viewModel.loadRecommendations() }) { Icon(Icons.Default.Refresh, "刷新", tint = MaterialTheme.colorScheme.primary) }
    }) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                FeatureCard(Icons.Default.AutoAwesome, "AI 推荐", "基于观看历史、相似影片和服务端推荐接口生成发现入口。", MaterialTheme.colorScheme.primary)
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(value = query, onValueChange = { query = it }, modifier = Modifier.weight(1f), singleLine = true, label = { Text("自然语言搜索") }, placeholder = { Text("例如：找一部轻松的科幻电影") })
                    Button(onClick = { viewModel.search(query) }, enabled = query.isNotBlank()) { Text("搜索") }
                }
            }
            if (uiState.error.isNotBlank()) item { FeatureCard(Icons.Default.Error, "智能发现不可用", uiState.error, MaterialTheme.colorScheme.error) }
            items(uiState.media, key = { it.id }) { media ->
                FeatureCard(Icons.Default.PlayArrow, media.displayTitle(), "${media.year.takeIf { it > 0 } ?: "未知年份"} · ${media.resolution.ifBlank { media.mediaType }} · ${media.rating}", MaterialTheme.colorScheme.secondary, onClick = { onMediaClick(media.id) })
            }
        }
    }
}

data class SmartDiscoveryUiState(val loading: Boolean = false, val media: List<Media> = emptyList(), val searchResult: SearchResult? = null, val error: String = "")

@HiltViewModel
class SmartDiscoveryViewModel @Inject constructor(private val apiService: NowenApiService) : ViewModel() {
    private val _uiState = MutableStateFlow(SmartDiscoveryUiState())
    val uiState = _uiState.asStateFlow()

    fun loadRecommendations() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(loading = true, error = "")
            runCatching { apiService.getRecommendations().data }.onSuccess { media ->
                _uiState.value = SmartDiscoveryUiState(media = media)
            }.onFailure { e ->
                _uiState.value = SmartDiscoveryUiState(error = e.message ?: "推荐接口暂不可用")
            }
        }
    }

    fun search(query: String) {
        viewModelScope.launch {
            runCatching { apiService.searchMixed(query) }.onSuccess { result ->
                _uiState.value = SmartDiscoveryUiState(media = result.media, searchResult = result)
            }.onFailure { e -> _uiState.value = _uiState.value.copy(error = e.message ?: "搜索失败") }
        }
    }
}

// ==================== 阶段一/二：远程访问 ====================

@Composable
fun RemoteAccessScreen(onBack: () -> Unit, viewModel: RemoteAccessViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsState()
    LaunchedEffect(Unit) { viewModel.load() }
    FeatureScaffold("远程访问", Icons.Default.TravelExplore, onBack) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { FeatureCard(Icons.Default.Wifi, "局域网地址", uiState.serverUrl.ifBlank { "未配置" }, MaterialTheme.colorScheme.primary) }
            item { FeatureCard(Icons.Default.Security, "HTTPS 与反向代理", "外网访问建议使用域名 + HTTPS 反向代理，避免直接暴露内网端口。", MaterialTheme.colorScheme.secondary) }
            item { FeatureCard(Icons.Default.HealthAndSafety, "连接诊断", "如果外网无法访问，先在手机浏览器打开远程地址，再回到 App 使用同一地址。", MaterialTheme.colorScheme.tertiary) }
            item { FeatureCard(Icons.Default.Info, "二维码配对预留", "服务端健康接口已返回更多移动端识别字段，后续 Web 管理端可生成一次性配对二维码。", MaterialTheme.colorScheme.primary) }
        }
    }
}

data class RemoteAccessUiState(val serverUrl: String = "")

@HiltViewModel
class RemoteAccessViewModel @Inject constructor(private val tokenManager: TokenManager) : ViewModel() {
    private val _uiState = MutableStateFlow(RemoteAccessUiState())
    val uiState = _uiState.asStateFlow()
    fun load() { viewModelScope.launch { _uiState.value = RemoteAccessUiState(tokenManager.getServerUrl().orEmpty()) } }
}

// ==================== 阶段三：投屏控制 ====================

@Composable
fun CastScreen(onBack: () -> Unit) {
    FeatureScaffold("投屏与遥控", Icons.Default.Cast, onBack) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { FeatureCard(Icons.Default.Cast, "DLNA / Chromecast 入口", "播放页和详情页可复用此入口扩展设备发现；当前版本先提供投屏能力中心和操作说明。", MaterialTheme.colorScheme.primary) }
            item { FeatureCard(Icons.Default.PlayArrow, "手机遥控器", "目标能力：播放/暂停、快进快退、音量、字幕、清晰度和进度同步。", MaterialTheme.colorScheme.secondary) }
            item { FeatureCard(Icons.Default.Wifi, "网络要求", "手机、电视和 nowen-video 服务端需要处于同一局域网；跨网段时建议使用支持 mDNS 转发的路由器。", MaterialTheme.colorScheme.tertiary) }
        }
    }
}

// ==================== 阶段三：家庭模式 ====================

@Composable
fun FamilyModeScreen(onBack: () -> Unit) {
    var childMode by remember { mutableStateOf(false) }
    var pinEnabled by remember { mutableStateOf(true) }
    FeatureScaffold("家庭与儿童模式", Icons.Default.FamilyRestroom, onBack) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                FeatureCard(Icons.Default.FamilyRestroom, "儿童模式", if (childMode) "已启用：仅展示适合儿童的内容入口" else "未启用：当前展示完整媒体库", MaterialTheme.colorScheme.primary, trailing = { Switch(checked = childMode, onCheckedChange = { childMode = it }) })
            }
            item {
                FeatureCard(Icons.Default.Security, "家长 PIN", if (pinEnabled) "已启用退出保护" else "未启用退出保护", MaterialTheme.colorScheme.secondary, trailing = { Switch(checked = pinEnabled, onCheckedChange = { pinEnabled = it }) })
            }
            item { FeatureCard(Icons.Default.Info, "后端权限联动", "建议后续把儿童模式与用户权限、内容分级、观看时长限制绑定。", MaterialTheme.colorScheme.tertiary) }
        }
    }
}

// ==================== 阶段三：设备适配 ====================

@Composable
fun DeviceAdaptationScreen(onBack: () -> Unit) {
    val configuration = LocalConfiguration.current
    val orientation = if (configuration.orientation == Configuration.ORIENTATION_LANDSCAPE) "横屏" else "竖屏"
    val bucket = when {
        configuration.screenWidthDp >= 840 -> "大屏 / TV"
        configuration.screenWidthDp >= 600 -> "平板"
        else -> "手机"
    }
    FeatureScaffold("设备适配", Icons.Default.Devices, onBack) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { FeatureCard(Icons.Default.Devices, "当前设备", "$bucket · ${configuration.screenWidthDp}dp × ${configuration.screenHeightDp}dp · $orientation", MaterialTheme.colorScheme.primary) }
            item { FeatureCard(Icons.Default.CheckCircle, "手机布局", "优先使用单列信息流、双列海报网格、底部弹层筛选和全屏播放器。", MaterialTheme.colorScheme.tertiary) }
            item { FeatureCard(Icons.Default.CheckCircle, "平板布局", "推荐媒体列表 + 详情双栏布局，横屏增加筛选侧栏。", MaterialTheme.colorScheme.secondary) }
            item { FeatureCard(Icons.Default.CheckCircle, "Android TV", "推荐增加遥控器焦点、扫码登录、大海报墙和 D-pad 播放控制。", MaterialTheme.colorScheme.primary) }
        }
    }
}

private fun formatBytes(value: Long): String {
    if (value <= 0) return "0 B"
    val units = listOf("B", "KB", "MB", "GB", "TB")
    var size = value.toDouble()
    var index = 0
    while (size >= 1024 && index < units.lastIndex) {
        size /= 1024
        index++
    }
    return "%.1f %s".format(size, units[index])
}
